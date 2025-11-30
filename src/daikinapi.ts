import axios, { AxiosResponse } from 'axios';
import { hrtime } from 'process';
import { Logging } from 'homebridge';
import {
  AirQualityLevel,
  Thermostat,
  ThermostatData,
  ThermostatUpdate,
  EquipmentStatus,
  FanCirculateMode,
  TemperatureUnit,
  ThermostatMode,
} from './types.js';

/**
 * Token response from the Daikin authentication API.
 */
interface DaikinTokenResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export type DataChanged = () => void;

// After sending an update to the Daikin API it will return old data for up to 15 seconds, so we
// delay fetching data after an update by this amount. https://daikinone.com/openapi/documentation/
export const DAIKIN_DEVICE_WRITE_DELAY_MS = 15 * 1000;

// User is not interacting with a HomeKit controller - background updates for automations
export const DAIKIN_DEVICE_BACKGROUND_REFRESH_MS = 180 * 1000;

// User is interacting with a HomeKit controller - latest data needed
export const DAIKIN_DEVICE_FOREGROUND_REFRESH_MS = 10 * 1000;

export class DaikinApi {
  private _token: DaikinTokenResponse | undefined;
  private _tokenExpiration = new Date(0);
  private _devices: Thermostat[] = []; // cache of all devices (thermostats) and their state
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

  constructor(user: string, password: string, log: Logging) {
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

  async Initialize() {
    await this.getToken();

    if (!this._token) {
      this.log.error('Unable to retrieve token.');
      return;
    }

    await this.getDevices();

    if (this._devices.length > 0) {
      this.log.debug('Found %d devices: ', this._devices.length);
      this._devices.forEach(element => {
        this.log.debug('Device: %s', element.name);
      });
    } else {
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
  async getData() {
    this.log.debug('Getting data...');
    this._lastReadStartTimeMs = this._monotonic_clock_ms();
    this._lastReadFinishTimeMs = -1;
    this.log.debug(
      'GS: %d ; %d ; WT: %d ; %d',
      this._lastReadStartTimeMs,
      this._lastReadFinishTimeMs,
      this._lastWriteStartTimeMs,
      this._lastWriteFinishTimeMs,
    );

    for (const device of this._devices) {
      const data = await this.getDeviceData(device.id);
      if (!data) {
        this.log.error('Unable to retrieve data for %s.', device.name);
        continue;
      }
      this._updateCache(device.id, data);
    }
    this.log.debug('Notifying all listeners');
    this.notifyListeners();
    this.log.debug('Updated data.');
    this._lastReadFinishTimeMs = this._monotonic_clock_ms();
    this.log.debug(
      'GF: %d ; %d ; WT: %d ; %d',
      this._lastReadStartTimeMs,
      this._lastReadFinishTimeMs,
      this._lastWriteStartTimeMs,
      this._lastWriteFinishTimeMs,
    );

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
    } else {
      this._scheduleFuture(blockUntilMs);
    }
  }

  private _scheduleAsap(blockUntilMs?: number) {
    if (blockUntilMs) {
      this.log.error('Ignoring blockUntilMs when scheduling ASAP');
    }

    const sinceLastUpdateMs = this._monotonic_clock_ms() - this._lastUpdateTimeMs;
    const minUntilNextUpdateMs = this._noUpdateBeforeMs - this._monotonic_clock_ms();
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

  private _scheduleFuture(blockUntilMs?: number) {
    let nextUpdateInMs: number;
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
    } else if (blockUntilMs === DAIKIN_DEVICE_WRITE_DELAY_MS) {
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
    this._updateTimeout = setTimeout(() => {
      void (async () => {
        this._lastUpdateTimeMs = this._monotonic_clock_ms();
        try {
          await this.getData();
        } catch (err) {
          this.logError('Error in scheduled update:', err);
        }
      })();
    }, nextUpdateMs);
    this._nextUpdateTimeMs = this._monotonic_clock_ms() + nextUpdateMs;
    this.log.debug('Scheduled update in %d.', nextUpdateMs);
  }

  private _monotonic_clock_ms(): number {
    return Number(hrtime.bigint() / BigInt(1000000));
  }

  async getToken() {
    this.log.debug('Getting token...');
    try {
      const response = await axios.post(
        'https://api.daikinskyport.com/users/auth/login',
        {
          email: this.user,
          password: this.password,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      );
      this.setToken(response);
    } catch (error) {
      this.logError('Error getting token:', error);
    }
  }

  setToken(response: AxiosResponse<DaikinTokenResponse>) {
    this._token = response.data;
    this._tokenExpiration = new Date();

    const expSeconds =
      this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn - (DAIKIN_DEVICE_BACKGROUND_REFRESH_MS / 1000) * 2;

    //Set expiration a little early.
    this._tokenExpiration.setSeconds(expSeconds);
  }

  async getDevices() {
    const response = await this.getRequest('https://api.daikinskyport.com/devices');
    this._devices = response ?? [];
    return this._devices;
  }

  getDeviceData(deviceId: string): Promise<ThermostatData | undefined> {
    return this.getRequest(`https://api.daikinskyport.com/deviceData/${deviceId}`);
  }

  async refreshToken() {
    if (typeof this._token === 'undefined' || typeof this._token.refreshToken === 'undefined' || !this._token.refreshToken) {
      this.log.debug('Cannot refresh token. Getting new token.');
      return this.getToken();
    }
    try {
      const response = await axios.post(
        'https://api.daikinskyport.com/users/auth/token',
        {
          email: this.user,
          refreshToken: this._token.refreshToken,
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      );
      this.setToken(response);
    } catch (error) {
      this.logError('Error refreshing token:', error);
    }
  }

  async getRequest(uri: string) {
    if (new Date() >= this._tokenExpiration) {
      await this.refreshToken();
    }
    if (!this._token) {
      this.log.error('No token for request: %s', uri);
      return undefined;
    }
    try {
      const response = await axios.get(uri, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._token.accessToken}`,
        },
      });
      return response.data;
    } catch (error) {
      this.logError(`Error with getRequest: ${uri}`, error);
      return undefined;
    }
  }

  getDeviceList(): Thermostat[] {
    return this._devices;
  }

  getDeviceName(deviceName: number, deviceNameCustom: string): string {
    switch (deviceName) {
      case 0:
        return deviceNameCustom;
      case 1:
        return 'main room';
      case 2:
        return 'upstairs';
      case 3:
        return 'downstairs';
      case 4:
        return 'hallway';
      case 5:
        return 'bedroom';
      case 6:
        return 'kitchen';
      default:
        return 'other';
    }
  }

  deviceHasData(deviceId: string): boolean {
    return !!this._devices.find(e => e.id === deviceId);
  }

  getCurrentStatus(deviceId: string): EquipmentStatus {
    return this._cachedDeviceById(deviceId).data.equipmentStatus;
  }

  getCurrentTemp(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.tempIndoor;
  }

  getOutdoorTemp(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.tempOutdoor;
  }

  getTargetState(deviceId: string): ThermostatMode {
    return this._cachedDeviceById(deviceId).data.mode;
  }

  getOneCleanFanActive(deviceId: string): boolean {
    return this._cachedDeviceById(deviceId).data.oneCleanFanActive;
  }

  getCirculateAirFanActive(deviceId: string): boolean {
    return this._cachedDeviceById(deviceId).data.fanCirculate !== FanCirculateMode.OFF;
  }

  getCirculateAirFanSpeed(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.fanCirculateSpeed;
  }

  getTargetTemp(deviceId: string): number {
    const data = this._cachedDeviceById(deviceId).data;
    switch (data.mode) {
      case ThermostatMode.HEAT:
      case ThermostatMode.EMERGENCY_HEAT:
      case ThermostatMode.AUTO:
        return data.hspActive;
      case ThermostatMode.COOL:
      default:
        return data.cspActive;
    }
  }

  heatingThresholdTemperature(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.hspActive;
  }

  coolingThresholdTemperature(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.cspActive;
  }

  getCurrentHumidity(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.humIndoor;
  }

  getOutdoorHumidity(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.humOutdoor;
  }

  getTargetHumidity(deviceId: string): number {
    return this._cachedDeviceById(deviceId).data.humSP;
  }

  getAirQualityLevel(deviceId: string, forIndoor: boolean): AirQualityLevel {
    const data = this._cachedDeviceById(deviceId).data;
    return forIndoor ? data.aqIndoorLevel : data.aqOutdoorLevel;
  }

  getOzone(deviceId: string, forIndoor: boolean): number {
    return forIndoor ? 0 : this._cachedDeviceById(deviceId).data.aqOutdoorOzone;
  }

  getAirQualityValue(deviceId: string, forIndoor: boolean): number {
    const data = this._cachedDeviceById(deviceId).data;
    return forIndoor ? data.aqIndoorValue : data.aqOutdoorValue;
  }

  getPM2_5Density(deviceId: string, forIndoor: boolean): number {
    const data = this._cachedDeviceById(deviceId).data;
    return forIndoor ? data.aqIndoorParticlesValue : data.aqOutdoorParticles;
  }

  getVocDensity(deviceId: string, forIndoor: boolean): number {
    return forIndoor ? this._cachedDeviceById(deviceId).data.aqIndoorVOCValue : 0;
  }

  getDisplayUnits(deviceId: string): TemperatureUnit {
    return this._cachedDeviceById(deviceId).data.units;
  }

  getScheduleState(deviceId: string): boolean {
    const data = this._cachedDeviceById(deviceId).data;
    return data.schedOverride === 0 && data.schedEnabled && !data.geofencingAway;
  }

  getAwayState(deviceId: string): boolean {
    return this._cachedDeviceById(deviceId).data.geofencingAway;
  }

  async setTargetTemps(deviceId: string, targetTemp?: number, heatThreshold?: number, coolThreshold?: number): Promise<boolean> {
    const deviceData = this._cachedDeviceById(deviceId)?.data;
    if (!deviceData) {
      this.log.info('Device data could not be retrieved. Unable to set target temp. (%s)', deviceId);
      return false;
    }

    // apiData: fields to send to API (only writable fields)
    // cacheUpdate: fields to update in local cache (includes read-only derived fields for immediate UI feedback)
    let apiData: ThermostatUpdate;
    let cacheUpdate: ThermostatUpdate;

    // Only send the request if the request provides a value pertinent to the current state/mode.
    switch (deviceData.mode) {
      case ThermostatMode.HEAT:
      case ThermostatMode.EMERGENCY_HEAT:
        if (!targetTemp) {
          return true;
        }

        apiData = { hspHome: targetTemp };
        cacheUpdate = { hspHome: targetTemp, hspActive: targetTemp };
        break;
      case ThermostatMode.COOL:
        if (!targetTemp) {
          return true;
        }

        apiData = { cspHome: targetTemp };
        cacheUpdate = { cspHome: targetTemp, cspActive: targetTemp };
        break;
      case ThermostatMode.OFF:
        // Do nothing when off
        return true;
      case ThermostatMode.AUTO:
        //Disregard setting Target Temp when in auto/off
        if (targetTemp) {
          return true;
        }
        if (coolThreshold) {
          // Setting cool threshold for auto
          this.pendingCoolThreshold = coolThreshold;
        } else {
          // Setting heat threshold for auto
          this.pendingHeatThreshold = heatThreshold;
        }
        if (!this.pendingHeatThreshold || !this.pendingCoolThreshold) {
          return true;
        }

        apiData = {
          hspHome: this.pendingHeatThreshold,
          cspHome: this.pendingCoolThreshold,
        };
        cacheUpdate = {
          hspHome: this.pendingHeatThreshold,
          hspActive: this.pendingHeatThreshold,
          cspHome: this.pendingCoolThreshold,
          cspActive: this.pendingCoolThreshold,
        };
        // Reset pending thresholds
        this.pendingCoolThreshold = undefined;
        this.pendingHeatThreshold = undefined;
        break;
      default:
        this.log.info('Device is in an unknown state: %s. Unable to set target temp. (%s)', deviceData.mode, deviceId);
        return false;
    }

    if (deviceData.schedEnabled) {
      apiData.schedOverride = 1;
      cacheUpdate.schedOverride = 1;
    }

    const success = await this.putRequest(deviceId, apiData, 'setTargetTemps', 'Error updating target temp:');
    if (success) {
      // Update cache with both API fields and derived fields for immediate UI feedback
      this._updateCache(deviceId, cacheUpdate);
    }
    return success;
  }

  async setTargetState(deviceId: string, requestedState: ThermostatMode): Promise<boolean> {
    const requestedData = {
      mode: requestedState,
    };
    // Update cache immediately so subsequent commands (e.g., setTargetTemps from a scene) see the new mode
    this._updateCache(deviceId, { mode: requestedState });
    return this.putRequest(deviceId, requestedData, 'setTargetState', 'Error updating target state:');
  }

  async setOneCleanFanActive(deviceId: string, requestedState: boolean): Promise<boolean> {
    const requestedData = {
      oneCleanFanActive: requestedState,
    };
    return this.putRequest(deviceId, requestedData, 'setOneCleanFanActive', 'Error updating OneClean fan:');
  }

  async setCirculateAirFanActive(deviceId: string, requestedState: boolean): Promise<boolean> {
    const requestedData = {
      fanCirculate: requestedState ? 1 : 0,
    };
    return this.putRequest(deviceId, requestedData, 'setCirculateAirFanActive', 'Error updating Circulate Air fan:');
  }

  async setCirculateAirFanSpeed(deviceId: string, requestedSpeed: number): Promise<boolean> {
    let requestedData;
    if (requestedSpeed === -1) {
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

  async setDisplayUnits(deviceId: string, requestedUnits: TemperatureUnit): Promise<boolean> {
    const requestedData = {
      units: requestedUnits,
    };
    return this.putRequest(deviceId, requestedData, 'setDisplayUnits', 'Error updating display units:');
  }

  async setTargetHumidity(deviceId: string, requestedHumidity: number): Promise<boolean> {
    const requestedData = {
      humSP: requestedHumidity,
    };
    return this.putRequest(deviceId, requestedData, 'setTargetHumidity', 'Error updating target humidity:');
  }

  async setScheduleState(deviceId: string, requestedState: boolean): Promise<boolean> {
    let requestedData;
    //  when enabling the schedule state, a schedule must exist.
    if (requestedState) {
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

  async setAwayState(deviceId: string, requestedState: boolean, enableSchedule: boolean): Promise<boolean> {
    let requestedData;
    if (requestedState) {
      //  when enabling the away state, the schedule (if it exists) is automatically paused.
      requestedData = {
        geofencingAway: true,
      };
    } else {
      if (enableSchedule) {
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
  private async putRequest(deviceId: string, requestData: ThermostatUpdate, caller: string, errorHeader: string): Promise<boolean> {
    this.log.debug('Writing data: %s-> device: %s; requestData: %s', caller, deviceId, JSON.stringify(requestData));
    this._lastWriteStartTimeMs = this._monotonic_clock_ms();
    this._lastWriteFinishTimeMs = -1;
    this.log.debug(
      'WS: %d ; %d ; GT: %d ; %d',
      this._lastWriteStartTimeMs,
      this._lastWriteFinishTimeMs,
      this._lastReadStartTimeMs,
      this._lastReadFinishTimeMs,
    );

    if (!this._token) {
      this.log.error('No token for write request: %s', deviceId);
      return false;
    }

    try {
      const res = await axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, requestData, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._token.accessToken}`,
        },
      });
      this.log.debug('%s-> device: %s; response: %s', caller, deviceId, JSON.stringify(res.data));
      this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
      this.log.debug(
        'WF: %d ; %d ; GT: %d ; %d',
        this._lastWriteStartTimeMs,
        this._lastWriteFinishTimeMs,
        this._lastReadStartTimeMs,
        this._lastReadFinishTimeMs,
      );
      this._updateCache(deviceId, requestData);
      this._scheduleUpdate(DAIKIN_DEVICE_WRITE_DELAY_MS);
      return true;
    } catch (error) {
      this.logError(errorHeader, error);
      this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
      return false;
    }
  }

  private _updateCache(deviceId: string, partialUpdate: ThermostatUpdate) {
    const cachedDevice = this._devices.find(e => e.id === deviceId);
    if (cachedDevice) {
      const updatedData: ThermostatData = {
        ...cachedDevice.data,
        ...partialUpdate,
      };
      cachedDevice.data = updatedData;
      //this.log.debug('Updated cache for %s - %s', deviceId, JSON.stringify(partialUpdate));
      this.log.debug('Updated cache for %s', deviceId);
    } else {
      this.log.error("Cache update for device that doesn't exist:", deviceId);
    }
  }

  private _cachedDeviceById(deviceId: string): Thermostat {
    const device = this._devices.find(e => e.id === deviceId);
    if (!device) {
      throw new Error(`No cached data for device ${deviceId}`);
    }
    return device;
  }

  logError(message: string, error: unknown): boolean {
    this.log.error(message);
    // Handle axios errors which have response/request properties
    const axiosError = error as { response?: { data: unknown; status: number; headers: unknown }; request?: unknown; message?: string };
    if (axiosError.response) {
      // When response status code is out of 2xx range
      this.log.error('Response status: %d', axiosError.response.status);
      this.log.error('Response data: %s', JSON.stringify(axiosError.response.data));
      this.log.error('Response headers: %s', JSON.stringify(axiosError.response.headers));
    } else if (axiosError.request) {
      // When no response was received after request was made
      this.log.error('No response received for request');
    } else {
      // Error
      this.log.error(axiosError.message ?? String(error));
    }
    return false;
  }
}
