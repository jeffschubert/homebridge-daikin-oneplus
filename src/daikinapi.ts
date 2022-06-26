/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios';
import { hrtime } from 'process';

/**
 * Log levels to indicate importance of the logged message.
 * Every level corresponds to a certain color.
 *
 * - INFO: no color
 * - WARN: yellow
 * - ERROR: red
 * - DEBUG: gray
 *
 * Messages with DEBUG level are only displayed if explicitly enabled.
 */
export declare const enum LoggerLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

export declare const enum TargetHeatingCoolingState {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3,
  AUXILIARY_HEAT = 4
}

export type LogMessage = (level: LoggerLevel, message: string, ...parameters: any[]) => void

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

  constructor(
      private readonly user : string,
      private readonly password : string,
      private readonly log : LogMessage,
  ){

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
      this.log(LoggerLevel.ERROR, 'Unable to retrieve token.');
      return;
    }

    await this.getDevices();

    if(this._devices !== undefined){
      this.log(LoggerLevel.INFO, `Found ${this._devices.length} device(s): `);
      this._devices.forEach(element => {
        this.log(LoggerLevel.INFO, `Device: ${element.name}`);
      });
    }else {
      this.log(LoggerLevel.INFO, 'No devices found.');
      return;
    }

    await this.getData();
    this.log(LoggerLevel.INFO, 'Loaded initial data.');
    this._isInitialized = true;
  }

  isInitialized(): boolean {
    return this._isInitialized;
  }

  async getData(){
    this.log(LoggerLevel.DEBUG, 'Getting data...');
    this._devices && this._devices.forEach(async device => {
      const data = await this.getDeviceData(device.id);
      if(!data){
        this.log(LoggerLevel.ERROR, `Unable to retrieve data for ${device.name}.`);
        return;
      }
      this._updateCache(device.id, data);
      this.log(LoggerLevel.DEBUG, 'Notifying all listeners');
      this.notifyListeners();
    });
    this.log(LoggerLevel.DEBUG, 'Updated data.');

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
      if (blockUntilMs) {
        this.log(LoggerLevel.ERROR, 'Ignoring blockUntilMs when scheduling ASAP');
      }

      const sinceLastUpdateMs = this._monotonic_clock_ms()-this._lastUpdateTimeMs;
      const minUntilNextUpdateMs = this._noUpdateBeforeMs-this._monotonic_clock_ms();
      if (sinceLastUpdateMs > DAIKIN_DEVICE_FOREGROUND_REFRESH_MS) {
        if (minUntilNextUpdateMs <= 0) {
          this.log(LoggerLevel.DEBUG, 'instant refresh now');
          this._updateIn(0);
        } else {
          this.log(LoggerLevel.DEBUG, `instant refresh when update is allowed in ${minUntilNextUpdateMs}`);
          this._updateIn(minUntilNextUpdateMs);
        }
      } else {
        const sinceLastUpdateMs = this._monotonic_clock_ms() - this._lastUpdateTimeMs;
        const updateInMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS - sinceLastUpdateMs;
        this.log(LoggerLevel.DEBUG, `next allowed poll in ${updateInMs}`);
        this._updateIn(Math.max(minUntilNextUpdateMs, updateInMs));
      }

      return;
    }

    let nextUpdateInMs:number;
    if (!blockUntilMs) {
      blockUntilMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
      nextUpdateInMs = DAIKIN_DEVICE_BACKGROUND_REFRESH_MS;
    } else if (blockUntilMs < DAIKIN_DEVICE_FOREGROUND_REFRESH_MS) {
      this.log(LoggerLevel.ERROR, `blockUntilMs too small ${blockUntilMs} is less than ${DAIKIN_DEVICE_FOREGROUND_REFRESH_MS}`);
      blockUntilMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
      nextUpdateInMs = DAIKIN_DEVICE_FOREGROUND_REFRESH_MS;
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
      this.log(LoggerLevel.DEBUG, `Not rescheduling next update because ${scheduledRunInMs} is after ${blockUntilMs}`);
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
    this.log(LoggerLevel.DEBUG, `scheduled update in ${nextUpdateMs}`);
  }

  private _monotonic_clock_ms(): number {
    return Number(hrtime.bigint()/BigInt(1000000));
  }

  async getToken(){
    this.log(LoggerLevel.DEBUG, 'Getting token...');
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
    //Set expiration a little early.
    this._tokenExpiration.setSeconds(
      this._tokenExpiration.getSeconds() 
    + this._token.accessTokenExpiresIn 
    - DAIKIN_DEVICE_BACKGROUND_REFRESH_MS*2);
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
      this.log(LoggerLevel.DEBUG, 'Cannot refresh token. Getting new token.');
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
      this.log(LoggerLevel.ERROR, `No token for request: ${uri}`);
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
        return device.data.hspActive;
      case TargetHeatingCoolingState.COOL:
      case TargetHeatingCoolingState.AUTO:
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

  getAwayState(deviceId: string): boolean {
    const device = this._cachedDeviceById(deviceId);
    return device.data.geofencingAway && device.data.geofencingEnabled;
  }

  async setTargetTemps(deviceId: string, targetTemp?: number, heatThreshold?: number, coolThreshold?: number): Promise<boolean>{
    const deviceData = this._cachedDeviceById(deviceId)?.data;
    if(!deviceData){
      this.log(LoggerLevel.INFO, `Device data could not be retrieved. Unable to set target temp. (${deviceId})`);
      return false;
    }

    let requestedData;
    switch (deviceData.mode) {
      case TargetHeatingCoolingState.HEAT:
      case TargetHeatingCoolingState.AUXILIARY_HEAT:
        requestedData = {
          hspHome: targetTemp || heatThreshold,
        };
        break;
      case TargetHeatingCoolingState.COOL:
        requestedData = {
          cspHome: targetTemp || coolThreshold,
        };
        break;
      case TargetHeatingCoolingState.AUTO:
        requestedData = {
          hspHome: heatThreshold,
          cspHome: coolThreshold,
        };
        break;
      default:
        this.log(LoggerLevel.INFO, `Device is in an unknown state: ${deviceData.mode}. Unable to set target temp. (${deviceId})`);
        return false;
    }

    if(deviceData.schedEnabled){
      requestedData.schedOverride = 1;
    }
    return this.putRequest(deviceId, requestedData, 'setTargetTemps', 'Error updating target temp:');
  }

  async setTargetState(deviceId: string, requestedState: number): Promise<boolean>{
    return this.putRequest(deviceId, {mode: requestedState}, 'setTargetState', 'Error updating target state:');
  }

  async setOneCleanFanActive(deviceId: string, requestedState: boolean): Promise<boolean>{
    return this.putRequest(deviceId, {oneCleanFanActive: requestedState}, 'setOneCleanFanActive', 'Error updating OneClean fan:');
  }

  async setCirculateAirFanActive(deviceId: string, requestedState: boolean): Promise<boolean>{
    return this.putRequest(deviceId, {fanCirculate: requestedState ? 1 : 0}, 
      'setCirculateAirFanActive', 'Error updating Circulate Air fan:');
  }

  async setCirculateAirFanSpeed(deviceId: string, requestedSpeed: number): Promise<boolean>{
    if(requestedSpeed === -1){
      return this.putRequest(deviceId, {fanCirculate: 0, fanCirculateSpeed: 1}, 
        'setCirculateAirFanSpeed', 'Error updating Circulate Air fan and speed:');
    } else {
      return this.putRequest(deviceId, {fanCirculateSpeed: requestedSpeed}, 
        'setCirculateAirFanSpeed', 'Error updating Circulate Air fan speed:');
    }
  }

  async setDisplayUnits(deviceId: string, requestedUnits: number) : Promise<boolean>{
    return this.putRequest(deviceId, {units: requestedUnits}, 'setDisplayUnits', 'Error updating display units:');
  }

  async setTargetHumidity(deviceId: string, requestedHumidity: number) : Promise<boolean>{
    return this.putRequest(deviceId, {humSP: requestedHumidity}, 'setTargetHumidity', 'Error updating target humidity:');
  }

  async setAwayState(deviceId: string, requestedState: boolean): Promise<boolean>{
    const deviceData = this._cachedDeviceById(deviceId)?.data;
    if(!deviceData){
      this.log(LoggerLevel.INFO, `Device data could not be retrieved. Unable to set away state. (${deviceId})`);
      return false;
    }

    let requestedData = {};
    switch(deviceData.geofencingEnabled){
      case true: //thermostat has geofencing enabled, thus we can just toggle away state
        requestedData = {geofencingAway: requestedState};
        break;
      case false: //thermostat has geofencing disabled, thus we need to set it and also toggle away state
        if(requestedState){
          requestedData = {
            geofencingEnabled: true, 
            geofencingAway: true,
          };
        } else{
          // nothing to do. geofencing is disabled so away state can't be set.
          this.log(LoggerLevel.INFO, `Device has geofencing disabled. Unable to set away state to off. (${deviceId})`);
          return true;
        }
        break;
    }
    return this.putRequest(deviceId, requestedData, 'setAwayState', 'Error updating away state:');
  }

  private putRequest(deviceId: string, requestData: any, caller: string, errorHeader: string): Promise<boolean>{
    this.log(LoggerLevel.DEBUG, `${caller}-> device: ${deviceId}; requestData: ${JSON.stringify(requestData)}`);
    return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
      requestData, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token.accessToken}`,
        },
      })
      .then(res => {
        this.log(LoggerLevel.DEBUG, `${caller}-> device: ${deviceId}; response:${JSON.stringify(res.data)}`);
        this._updateCache(deviceId, requestData);
        this._scheduleUpdate(DAIKIN_DEVICE_WRITE_DELAY_MS);
        return true;
      })
      .catch((error) => this.logError(errorHeader, error));
  }

  private _updateCache(deviceId: string, partialUpdate: any) {
    const cachedDevice = this._cachedDeviceById(deviceId);
    if (cachedDevice) {
      const updatedData = {
        ...cachedDevice.data,
        ...partialUpdate,
      };
      cachedDevice.data = updatedData;
      this.log(LoggerLevel.DEBUG, `Updated cache for ${deviceId} - ${JSON.stringify(partialUpdate)}`);
    } else {
      this.log(LoggerLevel.ERROR, `Cache update for device that doesn't exist: ${deviceId}`);
    }
  }

  private _cachedDeviceById(deviceId: string) {
    if (!this._devices) {
      return undefined;
    }
    return this._devices.find(e => e.id === deviceId);
  }

  logError(message: string, error): boolean{
    this.log(LoggerLevel.ERROR, message);
    if (error.response) {
      // When response status code is out of 2xx range 
      this.log(LoggerLevel.ERROR, 'Error with response:');
      this.log(LoggerLevel.ERROR, error.response.data);
      this.log(LoggerLevel.ERROR, error.response.status);
      this.log(LoggerLevel.ERROR, error.response.headers);
    } else if (error.request) {
      // When no response was received after request was made
      this.log(LoggerLevel.ERROR, 'Error with request:');
      this.log(LoggerLevel.ERROR, error.request);
    } else {
      // Error
      this.log(LoggerLevel.ERROR, 'General error:');
      this.log(LoggerLevel.ERROR, error.message);
    }
    return false;
  }
}