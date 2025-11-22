/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios';
import { hrtime } from 'process';
import { Logging } from 'homebridge';

export declare const enum TargetHeatingCoolingState {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3,
  AUXILIARY_HEAT = 4
}

export type DataChanged = () => void

// After sending an update to the Daikin API it will return old data for up to 15 seconds, so we
// delay fetching data after an update by this amount. https://daikinone.com/openapi/documentation/
export const DAIKIN_DEVICE_WRITE_DELAY_MS = 15*1000;

// User is not interacting with a HomeKit controller - background updates for automations
export const DAIKIN_DEVICE_BACKGROUND_REFRESH_MS = 180*1000;

// User is interacting with a HomeKit controller - latest data needed
export const DAIKIN_DEVICE_FOREGROUND_REFRESH_MS = 10*1000;

export class DaikinApi{
  private _token;
  private _tokenExpiration;
  private _devices: any[] | undefined; // cache of all devices (thermostats) and their state
  private _isInitialized = false;
  private _listeners: Set<DataChanged> = new Set();

  private _lastUpdateTimeMs = -1;
  private _nextUpdateTimeMs = -1;
  private _noUpdateBeforeMs = 0;
  private _updateTimeout?: NodeJS.Timeout;

  private _lastWriteStartTimeMs = -1;
  private _lastWriteFinishTimeMs = -1;
  private _lastReadStartTimeMs = -1;
  private _lastReadFinishTimeMs = -1;

  private user: string;
  private password: string;
  private log: Logging;

  private pendingCoolThreshold?: number;
  private pendingHeatThreshold?: number;

  constructor(
    user : string,
    password : string,
    log : Logging,
  ){
    this.log = log;
    this.user = user;
    this.password = password;
  }

  public addListener(l: DataChanged) {
    this._listeners.add(l);
  }

  public removeListener(l: DataChanged) {
    this._listeners.delete(l);
  }

  private notifyListeners() {
    for (const l of this._listeners) {
      l();
    }
  }

  async Initialize(){
    await this.getToken();
    
    if(this._token === undefined || this._token === null){
      this.log.error('Unable to retrieve token.');
      return;
    }

    await this.getDevices();

    if(this._devices !== undefined){
      this.log.debug('Found %s devices: ', this._devices.length);
      this._devices.forEach(element => {
        this.log.debug('Device: %s', element.name);
      });
    }else {
      this.log.info('No devices found.');
      return;
    }

    await this.getData();
    this.log.debug('Loaded initial data.');
    this._isInitialized = true;
  }

  isInitialized(): boolean {
    return this._isInitialized;
  }

  //TODO: if writing data or timer exists to write data, don't send get request
  //TODO: if data received while writing or waiting to write, toss
  //TODO: if above is done, then gets after, but within write delay time will get delayed.
  async getData(){
    this.log.debug('Getting data...');
    this._lastReadStartTimeMs = this._monotonic_clock_ms();
    this._lastReadFinishTimeMs = -1;
    this.log.debug('GS: %d ; %d ; WT: %d ; %d', 
      this._lastReadStartTimeMs, this._lastReadFinishTimeMs,
      this._lastWriteStartTimeMs, this._lastWriteFinishTimeMs);

    if (this._devices) {
      this._devices.forEach(async device => {
        const data = await this.getDeviceData(device.id);
        if(!data){
          this.log.error('Unable to retrieve data for %s.', device.name);
          return;
        }
        this._updateCache(device.id, data);
        this.log.debug('Notifying all listeners');
        this.notifyListeners();
      });
    }
    this.log.debug('Updated data.');
    this._lastReadFinishTimeMs = this._monotonic_clock_ms();
    this.log.debug('GF: %d ; %d ; WT: %d ; %d', 
      this._lastReadStartTimeMs, this._lastReadFinishTimeMs,
      this._lastWriteStartTimeMs, this._lastWriteFinishTimeMs);

    this._nextUpdateTimeMs = -1;
    this._scheduleUpdate();
  }

  updateNow() {
    this._scheduleUpdate(undefined, true);
  }

  /**
   * Schedules the next update. The scheduler has 2 modes.
   *
   * ASAP:    Pull an update as soon as updates are neither blocked by a prior `blockUntilMs` value
   *          nor by the maximum refresh frequency `DAIKIN_DEVICE_FOREGROUND_REFRESH_MS`.
   *
   * Regular: Pull an update every `DAIKIN_DEVICE_BACKGROUND_REFRESH_MS`.
   *
   * @param blockUntilMs If given and > 0 then no updates are guaranteed to take place in the next `blockUntilMs` milliseconds.
   * @param asap perform update as soon as allowed by DAIKIN_DEVICE_FOREGROUND_REFRESH_MS
   */
  _scheduleUpdate(blockUntilMs?: number, asap = false) {
    if (asap) {
      this._scheduleAsap(blockUntilMs);
    }else {
      this._scheduleFuture(blockUntilMs);
    }
  }

  private _scheduleAsap(blockUntilMs?: number){
    if (blockUntilMs) {
      this.log.error('Ignoring blockUntilMs when scheduling ASAP');
    }

    const sinceLastUpdateMs = this._monotonic_clock_ms()-this._lastUpdateTimeMs;
    const minUntilNextUpdateMs = this._noUpdateBeforeMs-this._monotonic_clock_ms();
    if (sinceLastUpdateMs > DAIKIN_DEVICE_FOREGROUND_REFRESH_MS) {
      if (minUntilNextUpdateMs <= 0) {
        this.log.debug('Instant refresh now');
        this._updateIn(0);
      } else {
        this.log.debug('Instant refresh when update is allowed in %d', minUntilNextUpdateMs);
        this._updateIn(minUntilNextUpdateMs);
      }
    } else {
      const sinceLastUpdateMs = this._monotonic_clock_ms() - this._lastUpdateTimeMs;
      const updateInMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS - sinceLastUpdateMs;
      this.log.debug('Next allowed poll in %d', updateInMs);
      this._updateIn(Math.max(minUntilNextUpdateMs, updateInMs));
    }
  }

  private _scheduleFuture(blockUntilMs?: number){
    let nextUpdateInMs:number;
    // set how long to wait to do an update (blockUntilMs)
    // and when the next update should happen (nextUpdateInMs)
    // as of 8/25/23, blockUntilMs will either be undefined or DAIKIN_DEVICE_WRITE_DELAY_MS only
    if (!blockUntilMs) {
      // just got data
      blockUntilMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
      nextUpdateInMs = DAIKIN_DEVICE_BACKGROUND_REFRESH_MS;
    } else if (blockUntilMs < DAIKIN_DEVICE_FOREGROUND_REFRESH_MS) {
      this.log.debug('BlockUntilMs too small %d is less than %d', blockUntilMs, DAIKIN_DEVICE_FOREGROUND_REFRESH_MS);
      blockUntilMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
      nextUpdateInMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
    } else if (blockUntilMs === DAIKIN_DEVICE_WRITE_DELAY_MS){
      nextUpdateInMs = DAIKIN_DEVICE_WRITE_DELAY_MS;
    } else {
      nextUpdateInMs = DAIKIN_DEVICE_BACKGROUND_REFRESH_MS;
    }
    this._noUpdateBeforeMs = this._monotonic_clock_ms() + blockUntilMs;

    const scheduledRunInMs = this._nextUpdateTimeMs - this._monotonic_clock_ms();
    if (this._nextUpdateTimeMs === -1 || blockUntilMs > scheduledRunInMs) {
      // if no run is scheduled at all OR if a run is scheduled for sooner than the desired minimum wait, push it into the future
      this._updateIn(blockUntilMs > nextUpdateInMs ? blockUntilMs : nextUpdateInMs);
    } else {
      // if the next update is already far enough in the future, nothing else to do
      this.log.debug('Not rescheduling next update because %d is after %d', scheduledRunInMs, blockUntilMs);
    }
  }

  private _updateIn(nextUpdateMs: number) {
    if (this._updateTimeout) {
      clearTimeout(this._updateTimeout);
    }
    this._updateTimeout = setTimeout(async () => {
      this._lastUpdateTimeMs = this._monotonic_clock_ms();
      await this.getData();
    }, nextUpdateMs);
    this._nextUpdateTimeMs = this._monotonic_clock_ms() + nextUpdateMs;
    this.log.debug('Scheduled update in %d.', nextUpdateMs);
  }

  private _monotonic_clock_ms(): number {
    return Number(hrtime.bigint()/BigInt(1000000));
  }

  async getToken(){
    this.log.debug('Getting token...');
    return axios.post('https://api.daikinskyport.com/users/auth/login', {
      email: this.user,
      password: this.password,
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    }).then((response)=>this.setToken(response))
      .catch((error) => this.logError('Error getting token:', error));
  }

  async setToken(response: AxiosResponse<any>){
    this._token = response.data;
    this._tokenExpiration = new Date();

    const expSeconds = this._tokenExpiration.getSeconds() 
    + this._token.accessTokenExpiresIn 
    - (DAIKIN_DEVICE_BACKGROUND_REFRESH_MS/1000)*2;

    //Set expiration a little early.
    this._tokenExpiration.setSeconds(expSeconds);
  }

  getDevices(){
    return this.getRequest('https://api.daikinskyport.com/devices')
      .then((response) => this._devices = response);
  }

  getDeviceData(device){
    return this.getRequest(`https://api.daikinskyport.com/deviceData/${device}`);
  }

  refreshToken(){
    if(typeof this._token === 'undefined' ||
    typeof this._token.refreshToken === 'undefined' ||
    !this._token.refreshToken){
      this.log.debug('Cannot refresh token. Getting new token.');
      return this.getToken();
    }
    axios.post('https://api.daikinskyport.com/users/auth/token', {
      email: this.user,
      refreshToken: this._token.refreshToken,
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    }).then((response)=>this.setToken(response))
      .catch((error) => this.logError('Error refreshing token:', error));
  }

  getRequest(uri: string){
    if(new Date() >= this._tokenExpiration){
      this.refreshToken();
    }
    if(!this._token) {
      this.log.error('No token for request: %s', uri);
      return Promise.resolve();
    }
    return axios.get(uri, {
      headers:{
        'Accept': 'application/json',
        'Authorization': `Bearer ${this._token.accessToken}`,
      },
    }).then((response)=>response.data) 
      .catch((error) => {
        this.logError(`Error with getRequest: ${uri}`, error);
        return Promise.resolve();
      });
  }

  getDeviceList(){
    return this._devices;
  }

  getDeviceName(deviceName: number, deviceNameCustom: string): string {
    switch(deviceName){
      case 0: return deviceNameCustom;
      case 1: return 'main room';
      case 2: return 'upstairs';
      case 3: return 'downstairs';
      case 4: return 'hallway';
      case 5: return 'bedroom';
      case 6: return 'kitchen';
      default: return 'other';
    }
  }
  
  deviceHasData(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    if(typeof device === 'undefined' ||
    typeof device.data === 'undefined'){
      return false;
    }
    return true;
  }

  getCurrentStatus(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.equipmentStatus;
  }

  getCurrentTemp(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.tempIndoor;
  }

  getOutdoorTemp(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.tempOutdoor;
  }

  getTargetState(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.mode;
  }

  getOneCleanFanActive(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    return device.data.oneCleanFanActive;
  }

  getCirculateAirFanActive(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    return device.data.fanCirculate === 0 ? false : true;
  }

  getCirculateAirFanSpeed(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.fanCirculateSpeed;
  }

  getTargetTemp(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    switch(device.data.mode){
      case TargetHeatingCoolingState.HEAT:
      case TargetHeatingCoolingState.AUXILIARY_HEAT:
      case TargetHeatingCoolingState.AUTO:
        return device.data.hspActive;
      case TargetHeatingCoolingState.COOL:
      default:
        return device.data.cspActive;
    }
  }

  heatingThresholdTemperature(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.hspActive;
  }

  coolingThresholdTemperature(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.cspActive;
  }

  getCurrentHumidity(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.humIndoor;
  }

  getOutdoorHumidity(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.humOutdoor;
  }

  getTargetHumidity(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.humSP;
  }

  getAirQualityLevel(deviceId: string, forIndoor:boolean): number {
    const device = this._cachedDeviceById(deviceId);
    return forIndoor ? device.data.aqIndoorLevel : device.data.aqOutdoorLevel;
  }

  getOzone(deviceId: string, forIndoor:boolean): number {
    const device = this._cachedDeviceById(deviceId);
    return forIndoor ? 0 : device.data.aqOutdoorOzone;
  }

  getAirQualityValue(deviceId: string, forIndoor:boolean): number {
    const device = this._cachedDeviceById(deviceId);
    return forIndoor ? device.data.aqIndoorValue : device.data.aqOutdoorValue;
  }

  getPM2_5Density(deviceId: string, forIndoor:boolean): number {
    const device = this._cachedDeviceById(deviceId);
    return forIndoor ? device.data.aqIndoorParticlesValue : device.data.aqOutdoorParticles;
  }

  getVocDensity(deviceId: string, forIndoor:boolean): number {
    const device = this._cachedDeviceById(deviceId);
    return forIndoor ? device.data.aqIndoorVOCValue : 0;
  }

  getDisplayUnits(deviceId: string): number {
    const device = this._cachedDeviceById(deviceId);
    return device.data.units;
  }

  getScheduleState(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    return device.data.schedOverride === 0 && device.data.schedEnabled && !device.data.geofencingAway;
  }

  getAwayState(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    return device.data.geofencingAway;
  }

  async setTargetTemps(deviceId: string, targetTemp?: number, heatThreshold?: number, coolThreshold?: number): Promise<boolean>{
    const deviceData = this._cachedDeviceById(deviceId)?.data;
    if(!deviceData){
      this.log.info('Device data could not be retrieved. Unable to set target temp. (%s)', deviceId);
      return false;
    }

    let requestedData;
    // Only send the request if the request provides a value pertinent to the current state/mode.
    switch (deviceData.mode) {
      case TargetHeatingCoolingState.HEAT:
      case TargetHeatingCoolingState.AUXILIARY_HEAT:
        if(!targetTemp) {
          return true;
        }

        requestedData = {
          hspHome: targetTemp,
        };
        break;
      case TargetHeatingCoolingState.COOL:
        if(!targetTemp){
          return true;
        }

        requestedData = {
          cspHome: targetTemp,
        };
        break;
      case TargetHeatingCoolingState.OFF:
        // Do nothing when off
        return true;
      case TargetHeatingCoolingState.AUTO:
        //Disregard setting Target Temp when in auto/off
        if(targetTemp){
          return true;
        }
        if(coolThreshold){
          // Setting cool threshold for auto
          this.pendingCoolThreshold = coolThreshold;
        } else{
          // Setting heat threshold for auto
          this.pendingHeatThreshold = heatThreshold;
        }
        if(!this.pendingHeatThreshold || !this.pendingCoolThreshold){
          return true;
        }

        requestedData = {
          hspHome: this.pendingHeatThreshold,
          cspHome: this.pendingCoolThreshold,
        };
        // Reset pending thresholds
        this.pendingCoolThreshold = undefined;
        this.pendingHeatThreshold = undefined;
        break;
      default:
        this.log.info('Device is in an unknown state: %s. Unable to set target temp. (%s)', deviceData.mode, deviceId);
        return false;
    }
    
    if(deviceData.schedEnabled){
      requestedData.schedOverride = 1;
    }
    return this.putRequest(deviceId, requestedData, 'setTargetTemps', 'Error updating target temp:');
  }

  async setTargetState(deviceId: string, requestedState: number): Promise<boolean>{
    const requestedData = {
      mode: requestedState,
    };
    return this.putRequest(deviceId, requestedData, 'setTargetState', 'Error updating target state:');
  }

  async setOneCleanFanActive(deviceId: string, requestedState: boolean): Promise<boolean>{
    const requestedData = {
      oneCleanFanActive: requestedState,
    };
    return this.putRequest(deviceId, requestedData, 'setOneCleanFanActive', 'Error updating OneClean fan:');
  }

  async setCirculateAirFanActive(deviceId: string, requestedState: boolean): Promise<boolean>{
    const requestedData = {
      fanCirculate: requestedState ? 1 : 0,
    };
    return this.putRequest(deviceId, requestedData, 'setCirculateAirFanActive', 'Error updating Circulate Air fan:');
  }

  async setCirculateAirFanSpeed(deviceId: string, requestedSpeed: number): Promise<boolean>{
    let requestedData;
    if(requestedSpeed === -1){
      requestedData = {
        fanCirculate: 0, 
        fanCirculateSpeed: 1,
      };
    } else {
      requestedData = {
        fanCirculateSpeed: requestedSpeed,
      };
    }
    return this.putRequest(deviceId, requestedData, 'setCirculateAirFanSpeed', 'Error updating Circulate Air fan and speed:');
  }

  async setDisplayUnits(deviceId: string, requestedUnits: number) : Promise<boolean>{
    const requestedData = {
      units: requestedUnits,
    };
    return this.putRequest(deviceId, requestedData, 'setDisplayUnits', 'Error updating display units:');
  }

  async setTargetHumidity(deviceId: string, requestedHumidity: number) : Promise<boolean>{
    const requestedData = {
      humSP: requestedHumidity,
    };
    return this.putRequest(deviceId, requestedData, 'setTargetHumidity', 'Error updating target humidity:');
  }

  async setScheduleState(deviceId: string, requestedState: boolean): Promise<boolean>{
    let requestedData;
    //  when enabling the schedule state, a schedule must exist.
    if(requestedState){
      requestedData = {
        geofencingAway: false,
        schedOverride: 0,
        schedEnabled: true,
      };
    } else {
      requestedData = {
        schedEnabled: false,
      };    
    }
    this.log.debug('Schedule for %s: %s: %s', deviceId, requestedState, requestedData);
    return this.putRequest(deviceId, requestedData, 'setScheduleState', 'Error updating schedule state:');
  }

  async setAwayState(deviceId: string, requestedState: boolean, enableSchedule: boolean): Promise<boolean>{
    let requestedData;
    if(requestedState){
      //  when enabling the away state, the schedule (if it exists) is automatically paused.
      requestedData = {
        geofencingAway: true,
      };
    } else {
      if(enableSchedule){
        requestedData = {
          geofencingAway: false,
          schedEnabled: true,
        };

      } else {
        requestedData = {
          geofencingAway: false,
        };
      }
    }
    return this.putRequest(deviceId, requestedData, 'setAwayState', 'Error updating away state:');
  }

  //TODO: track data to be written per device
  //TODO: buffer write requests per device for up to a second (create timer? per device that when elapsed writes anything requested for it)
  //TODO: reset timer on every device's request. once there's a full second without a request, then send? 
  //TODO: always update cache data with requested so that local stays current with what will be state once written.
  private putRequest(deviceId: string, requestData: any, caller: string, errorHeader: string): Promise<boolean>{
    this.log.debug('Writing data: %s-> device: %s; requestData: %s', caller, deviceId, JSON.stringify(requestData));
    this._lastWriteStartTimeMs = this._monotonic_clock_ms();
    this._lastWriteFinishTimeMs = -1;
    this.log.debug('WS: %d ; %d ; GT: %d ; %d', 
      this._lastWriteStartTimeMs, this._lastWriteFinishTimeMs, 
      this._lastReadStartTimeMs, this._lastReadFinishTimeMs);
                  
    return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
      requestData, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token.accessToken}`,
        },
      })
      .then(res => {
        this.log.debug('%s-> device: %s; response: %s', caller, deviceId, JSON.stringify(res.data));
        this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
        this.log.debug('WF: %d ; %d ; GT: %d ; %d', 
          this._lastWriteStartTimeMs, this._lastWriteFinishTimeMs, 
          this._lastReadStartTimeMs, this._lastReadFinishTimeMs);
        this._updateCache(deviceId, requestData);
        this._scheduleUpdate(DAIKIN_DEVICE_WRITE_DELAY_MS);
        return true;
      })
      .catch((error) => {
        this.logError(errorHeader, error);
        this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
        return false;
      });
  }

  private _updateCache(deviceId: string, partialUpdate: any) {
    const cachedDevice = this._cachedDeviceById(deviceId);
    if (cachedDevice) {
      const updatedData = {
        ...cachedDevice.data,
        ...partialUpdate,
      };
      cachedDevice.data = updatedData;
      //this.log.debug('Updated cache for %s - %s', deviceId, JSON.stringify(partialUpdate));
      this.log.debug('Updated cache for %s', deviceId);
    } else {
      this.log.error('Cache update for device that doesn\'t exist:', deviceId);
    }
  }

  private _cachedDeviceById(deviceId: string) {
    if (!this._devices) {
      return undefined;
    }
    return this._devices.find(e => e.id === deviceId);
  }

  logError(message: string, error): boolean{
    this.log.error(message);
    if (error.response) {
      // When response status code is out of 2xx range 
      this.log.error('Error with response:');
      this.log.error(error.response.data);
      this.log.error(error.response.status);
      this.log.error(error.response.headers);
    } else if (error.request) {
      // When no response was received after request was made
      this.log.error('Error with request:');
      this.log.error(error.request);
    } else {
      // Error
      this.log.error('General error:');
      this.log.error(error.message);
    }
    return false;
  }
}