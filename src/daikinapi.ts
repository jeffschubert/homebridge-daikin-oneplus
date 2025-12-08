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

type DataChanged = () => void;

// After sending an update to the Daikin API it will return old data for up to 15 seconds, so we
// delay fetching data after an update by this amount. https://daikinone.com/openapi/documentation/
const DAIKIN_DEVICE_WRITE_DELAY_MS = 15 * 1000;

// User is not interacting with a HomeKit controller - background updates for automations
const DAIKIN_DEVICE_BACKGROUND_REFRESH_MS = 180 * 1000;

// User is interacting with a HomeKit controller - latest data needed
const DAIKIN_DEVICE_FOREGROUND_REFRESH_MS = 10 * 1000;

const DAIKIN_API_LOGIN_URL = 'https://api.daikinskyport.com/users/auth/login';

const DAIKIN_API_DEVICES_URL = 'https://api.daikinskyport.com/devices';

const DAIKIN_API_TOKEN_URL = 'https://api.daikinskyport.com/users/auth/token';

const getDeviceUrl = (deviceId: string) => {
  return `https://api.daikinskyport.com/deviceData/${deviceId}`;
};

export class DaikinApi {
  private _token: DaikinTokenResponse | undefined;
  private _tokenExpiration = new Date(0);
  private _devices: Map<string, Thermostat> = new Map(); // cache of all devices (thermostats) and their state
  private _isInitialized = false;
  private _listeners: Map<string, Set<DataChanged>> = new Map();

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

  // Pending thresholds per device for AUTO mode. HomeKit sends heat and cool thresholds
  // separately, but the Daikin API requires both in a single request.
  private _pendingThresholds: Map<string, { heat?: number; cool?: number }> = new Map();

  // Track emergency heat switch state per device. When the switch is ON, thermostat
  // mode changes to HEAT should use EMERGENCY_HEAT instead.
  private _emergencyHeatEnabled: Map<string, boolean> = new Map();

  public constructor(user: string, password: string, log: Logging) {
    this.log = log;
    this.user = user;
    this.password = password;
  }

  public addListener(deviceId: string, listener: DataChanged) {
    let deviceListeners = this._listeners.get(deviceId);
    if (!deviceListeners) {
      deviceListeners = new Set();
      this._listeners.set(deviceId, deviceListeners);
    }
    deviceListeners.add(listener);

    // Call listener immediately if data already exists (for initial state)
    if (this._devices.get(deviceId)?.data) {
      listener();
    }
  }

  public removeListener(deviceId: string, listener: DataChanged) {
    this._listeners.get(deviceId)?.delete(listener);
  }

  private notifyListeners(deviceId: string) {
    const deviceListeners = this._listeners.get(deviceId);
    if (deviceListeners) {
      for (const listener of deviceListeners) {
        listener();
      }
    }
  }

  public async Initialize() {
    await this.getToken();

    if (!this._token) {
      this.log.error('Unable to retrieve token.');
      return;
    }

    await this.getDevices();

    if (this._devices.size > 0) {
      this.log.debug('Found %d devices: ', this._devices.size);
      for (const device of this._devices.values()) {
        this.log.debug('Device: %s', device.name);
      }
    } else {
      this.log.info('No devices found.');
      return;
    }

    await this.getData();
    this.log.debug('Loaded initial data.');
    this._isInitialized = true;
  }

  public isInitialized(): boolean {
    return this._isInitialized;
  }

  private async getData() {
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

    for (const device of this._devices.values()) {
      const data = await this.getDeviceData(device.id);
      if (!data) {
        this.log.error('Unable to retrieve data for %s [%s].', device.id, device.name);
        continue;
      }
      this._updateCache(device.id, data);
      this.log.debug('Notifying listeners for device %s', device.id);
      this.notifyListeners(device.id);
    }
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

  public updateNow() {
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
  private _scheduleUpdate(blockUntilMs?: number, asap = false) {
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

  private async getToken() {
    this.log.debug('Getting token...');
    try {
      const response = await fetch(DAIKIN_API_LOGIN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.user,
          password: this.password,
        }),
      });

      if (!response.ok) {
        this.logError(`Request ${DAIKIN_API_LOGIN_URL} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        return;
      }

      const token: DaikinTokenResponse = await response.json();
      this.setToken(token);
    } catch (error) {
      this.logError('Error getting token:', error);
    }
  }

  private setToken(token: DaikinTokenResponse) {
    this._token = token;
    this._tokenExpiration = new Date();

    const expSeconds =
      this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn - (DAIKIN_DEVICE_BACKGROUND_REFRESH_MS / 1000) * 2;

    //Set expiration a little early.
    this._tokenExpiration.setSeconds(expSeconds);
  }

  private async getDevices() {
    const response: Thermostat[] = (await this.getRequest(DAIKIN_API_DEVICES_URL)) ?? [];
    this._devices = new Map(response.map(d => [d.id, d]));
    return this._devices;
  }

  public async getDeviceData(deviceId: string): Promise<ThermostatData | undefined> {
    return await this.getRequest(getDeviceUrl(deviceId));
  }

  private async refreshToken() {
    if (typeof this._token === 'undefined' || typeof this._token.refreshToken === 'undefined' || !this._token.refreshToken) {
      this.log.debug('Cannot refresh token. Getting new token.');
      return this.getToken();
    }
    try {
      const response = await fetch(DAIKIN_API_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.user,
          refreshToken: this._token.refreshToken,
        }),
      });

      if (!response.ok) {
        this.logError(`Request ${DAIKIN_API_TOKEN_URL} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        return;
      }

      const token: DaikinTokenResponse = await response.json();
      this.setToken(token);
    } catch (error) {
      this.logError('Error refreshing token:', error);
    }
  }

  private async getRequest(uri: string) {
    if (new Date() >= this._tokenExpiration) {
      await this.refreshToken();
    }
    if (!this._token) {
      this.log.error('No token for request: %s', uri);
      return undefined;
    }
    try {
      const response = await fetch(uri, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._token.accessToken}`,
        },
      });

      if (!response.ok) {
        this.logError(`Request ${uri} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        return undefined;
      }
      return response.json();
    } catch (error) {
      this.logError(`Error with getRequest: ${uri}`, error);
      return undefined;
    }
  }

  public getDeviceList(): Thermostat[] {
    return [...this._devices.values()];
  }

  public getCurrentStatus(deviceId: string): EquipmentStatus {
    return this._devices.get(deviceId)?.data?.equipmentStatus ?? EquipmentStatus.IDLE;
  }

  public getCurrentTemp(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.tempIndoor ?? -270;
  }

  public getOutdoorTemp(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.tempOutdoor ?? -270;
  }

  public getTargetState(deviceId: string): ThermostatMode {
    return this._devices.get(deviceId)?.data?.mode ?? ThermostatMode.OFF;
  }

  public getOneCleanFanActive(deviceId: string): boolean {
    return this._devices.get(deviceId)?.data?.oneCleanFanActive ?? false;
  }

  public getCirculateAirFanActive(deviceId: string): boolean {
    const fanCirculate = this._devices.get(deviceId)?.data?.fanCirculate;
    return fanCirculate !== undefined && fanCirculate !== FanCirculateMode.OFF;
  }

  public getCirculateAirFanSpeed(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.fanCirculateSpeed ?? 0;
  }

  public getTargetTemp(deviceId: string): number {
    const data = this._devices.get(deviceId)?.data;
    if (!data) return -270;
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

  public heatingThresholdTemperature(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.hspActive ?? -270;
  }

  public coolingThresholdTemperature(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.cspActive ?? -270;
  }

  public getCurrentHumidity(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.humIndoor ?? 0;
  }

  public getOutdoorHumidity(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.humOutdoor ?? 0;
  }

  public getTargetHumidity(deviceId: string): number {
    return this._devices.get(deviceId)?.data?.humSP ?? 0;
  }

  public getAirQualityLevel(deviceId: string, forIndoor: boolean): AirQualityLevel {
    const data = this._devices.get(deviceId)?.data;
    if (!data) return AirQualityLevel.GOOD;
    return forIndoor ? data.aqIndoorLevel : data.aqOutdoorLevel;
  }

  public getOzone(deviceId: string, forIndoor: boolean): number {
    if (forIndoor) return 0;
    return this._devices.get(deviceId)?.data?.aqOutdoorOzone ?? 0;
  }

  public getAirQualityValue(deviceId: string, forIndoor: boolean): number {
    const data = this._devices.get(deviceId)?.data;
    if (!data) return 0;
    return forIndoor ? data.aqIndoorValue : data.aqOutdoorValue;
  }

  public getPM2_5Density(deviceId: string, forIndoor: boolean): number {
    const data = this._devices.get(deviceId)?.data;
    if (!data) return 0;
    return forIndoor ? data.aqIndoorParticlesValue : data.aqOutdoorParticles;
  }

  public getVocDensity(deviceId: string, forIndoor: boolean): number {
    if (!forIndoor) return 0;
    return this._devices.get(deviceId)?.data?.aqIndoorVOCValue ?? 0;
  }

  public getDisplayUnits(deviceId: string): TemperatureUnit {
    return this._devices.get(deviceId)?.data?.units ?? TemperatureUnit.FAHRENHEIT;
  }

  public getScheduleState(deviceId: string): boolean {
    const data = this._devices.get(deviceId)?.data;
    if (!data) return false;
    return data.schedOverride === 0 && data.schedEnabled && !data.geofencingAway;
  }

  public getAwayState(deviceId: string): boolean {
    return this._devices.get(deviceId)?.data?.geofencingAway ?? false;
  }

  public setEmergencyHeatEnabled(deviceId: string, enabled: boolean): void {
    this._emergencyHeatEnabled.set(deviceId, enabled);
  }

  public isEmergencyHeatEnabled(deviceId: string): boolean {
    return this._emergencyHeatEnabled.get(deviceId) ?? false;
  }

  public async setTargetTemps(deviceId: string, targetTemp?: number, heatThreshold?: number, coolThreshold?: number): Promise<boolean> {
    const deviceData = this._devices.get(deviceId)?.data;
    if (!deviceData) {
      this.log.error('Cannot set target temps - no data for device:', deviceId);
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
      case ThermostatMode.AUTO: {
        // Disregard setting Target Temp when in auto/off
        if (targetTemp) {
          return true;
        }

        // Get or create pending thresholds for this device
        let pending = this._pendingThresholds.get(deviceId);
        if (!pending) {
          pending = {};
          this._pendingThresholds.set(deviceId, pending);
        }

        // Accumulate thresholds - HomeKit sends them separately
        if (coolThreshold !== undefined) {
          pending.cool = coolThreshold;
        }
        if (heatThreshold !== undefined) {
          pending.heat = heatThreshold;
        }

        // Wait until we have both thresholds before sending to API
        if (pending.heat === undefined || pending.cool === undefined) {
          return true;
        }

        apiData = {
          hspHome: pending.heat,
          cspHome: pending.cool,
        };
        cacheUpdate = {
          hspHome: pending.heat,
          hspActive: pending.heat,
          cspHome: pending.cool,
          cspActive: pending.cool,
        };

        // Reset pending thresholds for this device
        this._pendingThresholds.delete(deviceId);
        break;
      }
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

  public async setTargetState(deviceId: string, requestedState: ThermostatMode): Promise<boolean> {
    const requestedData = {
      mode: requestedState,
    };
    // Update cache immediately so subsequent commands (e.g., setTargetTemps from a scene) see the new mode
    this._updateCache(deviceId, { mode: requestedState });
    return this.putRequest(deviceId, requestedData, 'setTargetState', 'Error updating target state:');
  }

  public async setOneCleanFanActive(deviceId: string, requestedState: boolean): Promise<boolean> {
    const requestedData = {
      oneCleanFanActive: requestedState,
    };
    return this.putRequest(deviceId, requestedData, 'setOneCleanFanActive', 'Error updating OneClean fan:');
  }

  public async setCirculateAirFanActive(deviceId: string, requestedState: boolean): Promise<boolean> {
    const requestedData = {
      fanCirculate: requestedState ? 1 : 0,
    };
    return this.putRequest(deviceId, requestedData, 'setCirculateAirFanActive', 'Error updating Circulate Air fan:');
  }

  public async setCirculateAirFanSpeed(deviceId: string, requestedSpeed: number): Promise<boolean> {
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

  public async setDisplayUnits(deviceId: string, requestedUnits: TemperatureUnit): Promise<boolean> {
    const requestedData = {
      units: requestedUnits,
    };
    return this.putRequest(deviceId, requestedData, 'setDisplayUnits', 'Error updating display units:');
  }

  public async setTargetHumidity(deviceId: string, requestedHumidity: number): Promise<boolean> {
    const requestedData = {
      humSP: requestedHumidity,
    };
    return this.putRequest(deviceId, requestedData, 'setTargetHumidity', 'Error updating target humidity:');
  }

  public async setScheduleState(deviceId: string, requestedState: boolean): Promise<boolean> {
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

  public async setAwayState(deviceId: string, requestedState: boolean, enableSchedule: boolean): Promise<boolean> {
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
      const uri = getDeviceUrl(deviceId);
      const response = await fetch(uri, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._token.accessToken}`,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        this.logError(`Request ${uri} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
        return false;
      }

      this.log.debug('%s-> device: %s; response: %s', caller, deviceId, JSON.stringify(response.json()));
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
      this.logError(`${errorHeader} Device: ${deviceId}:`, error);
      this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
      return false;
    }
  }

  private _updateCache(deviceId: string, partialUpdate: ThermostatUpdate) {
    const cachedDevice = this._devices.get(deviceId);
    if (!cachedDevice) {
      this.log.error("Cache update for device that doesn't exist:", deviceId);
      return;
    }
    cachedDevice.data = {
      ...(cachedDevice.data ?? {}),
      ...partialUpdate,
    } as ThermostatData;
    this.log.debug('Updated cache for %s', deviceId);
  }

  private logError(message: string, error: unknown): boolean {
    this.log.error(message);
    this.log.error(String(error));
    return false;
  }
}
