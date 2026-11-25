import { discoverZones, zoneData, zoneField, zoneIdentity, zoneUpdate } from './zones.js';
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
import { HistoryStore } from './historyStore.js';
import { DaikinTransport, TransportCapabilities, logError } from './daikinTransport.js';
import { resolveDeviceIds } from './deviceIdentity.js';

type DataChanged = () => void;

// Model and firmware fields are fixed-width and space-padded. Slots the thermostat can't fill
// come back empty, as dashes, or as non-printable filler.
const readIdField = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed || /^-+$/.test(trimmed) || /[^ -~]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
};

export class DaikinApi {
  private _devices: Map<string, Thermostat> = new Map(); // cache of all devices (thermostats) and their state
  // Devices are keyed by a stable ID that survives switching transports; this maps it to the transport's own ID.
  private _transportIds: Map<string, string> = new Map();
  private _isInitialized = false;
  private stopped = false;
  private _listeners: Map<string, Set<DataChanged>> = new Map();

  private _lastUpdateTimeMs = -1;
  private _nextUpdateTimeMs = -1;
  private _noUpdateBeforeMs = 0;
  private _updateTimeout?: NodeJS.Timeout;

  private writeGeneration = 0;
  private activeWrites = 0;
  private _lastWriteStartTimeMs = -1;
  private _lastWriteFinishTimeMs = -1;
  private _lastReadStartTimeMs = -1;
  private _lastReadFinishTimeMs = -1;

  private transport: DaikinTransport;
  private log: Logging;
  private logRaw: boolean;
  private historyStore: HistoryStore;

  private readonly zoneWrites = new Map<string, Promise<boolean>>();
  private readonly readTimes = new Map<string, number>();
  private readonly staleAfterMs = 10 * 60 * 1000;

  // Track emergency heat switch state per device. When the switch is ON, thermostat
  // mode changes to HEAT should use EMERGENCY_HEAT instead.
  private _emergencyHeatEnabled: Map<string, boolean> = new Map();

  // Devices whose data shape isn't recognized. Warned about once, then skipped.
  private _unsupportedDevices: Set<string> = new Set();

  /**
   * @param knownDevices devices that already have accessories, used to keep their IDs when the transport's IDs differ
   */
  public constructor(
    transport: DaikinTransport,
    log: Logging,
    logRaw: boolean,
    historyStore: HistoryStore,
    private readonly knownDevices: () => Thermostat[] = () => [],
    private readonly enableAdditionalZoneControls = false,
  ) {
    this.transport = transport;
    this.log = log;
    this.logRaw = logRaw;
    this.historyStore = historyStore;
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
    if (!(await this.transport.initialize())) {
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
    const pollGeneration = this.writeGeneration;
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
      const generation = this.writeGeneration;
      const data = await this.getDeviceData(device.id);
      if (generation !== this.writeGeneration || this.activeWrites > 0 || this._noUpdateBeforeMs > this._monotonic_clock_ms()) continue;
      if (!data) {
        this.log.error('Unable to retrieve data for %s [%s].', device.id, device.name);
        this.notifyListeners(device.id);
        continue;
      }
      if (!this.isRecognizedData(device, data)) {
        this.notifyListeners(device.id);
        continue;
      }
      device.data = data;
      this.readTimes.set(device.id, Date.now());
      this.log.debug('Notifying listeners for device %s', device.id);
      this.notifyListeners(device.id);
      this.log.debug('Recording history for device %s', device.id);
      void this.historyStore.record(device.id, data, this.getTargetTempFromData(data));
      for (const zone of discoverZones(device).filter(zone => zone.number > 1)) {
        const values = zoneData(data, zone.number);
        void this.historyStore.record(device.id, values, this.getTargetTempFromData(values), zone);
      }
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
    this._scheduleUpdate(this.activeWrites > 0 || pollGeneration !== this.writeGeneration ? this.transport.timing.writeDelayMs : undefined);
  }

  public destroy(): void {
    this.stopped = true;
    clearTimeout(this._updateTimeout);
    this._listeners.clear();
  }

  public updateNow() {
    this._scheduleUpdate(undefined, true);
  }

  /**
   * Schedules the next update. The scheduler has 2 modes.
   *
   * ASAP:    Pull an update as soon as updates are neither blocked by a prior `blockUntilMs` value
   *          nor by the transport's `foregroundRefreshMs`.
   *
   * Regular: Pull an update every `backgroundRefreshMs`.
   *
   * @param blockUntilMs If given and > 0 then no updates are guaranteed to take place in the next `blockUntilMs` milliseconds.
   * @param asap perform update as soon as allowed by `foregroundRefreshMs`
   */
  private _scheduleUpdate(blockUntilMs?: number, asap = false) {
    if (this.stopped) return;
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
    if (sinceLastUpdateMs > this.transport.timing.foregroundRefreshMs) {
      if (minUntilNextUpdateMs <= 0) {
        this.log.debug('Instant refresh now');
        this._updateIn(0);
      } else {
        this.log.debug('Instant refresh when update is allowed in %d', minUntilNextUpdateMs);
        this._updateIn(minUntilNextUpdateMs);
      }
    } else {
      const sinceLastUpdateMs = this._monotonic_clock_ms() - this._lastUpdateTimeMs;
      const updateInMs = this.transport.timing.foregroundRefreshMs - sinceLastUpdateMs;
      this.log.debug('Next allowed poll in %d', updateInMs);
      this._updateIn(Math.max(minUntilNextUpdateMs, updateInMs));
    }
  }

  private _scheduleFuture(blockUntilMs?: number) {
    let nextUpdateInMs: number;
    // set how long to wait to do an update (blockUntilMs)
    // and when the next update should happen (nextUpdateInMs)
    // as of 8/25/23, blockUntilMs will either be undefined or writeDelayMs only
    if (!blockUntilMs) {
      // just got data
      blockUntilMs = this.transport.timing.foregroundRefreshMs;
      nextUpdateInMs = this.transport.timing.backgroundRefreshMs;
    } else if (blockUntilMs === this.transport.timing.writeDelayMs) {
      nextUpdateInMs = this.transport.timing.writeDelayMs;
    } else if (blockUntilMs < this.transport.timing.foregroundRefreshMs) {
      this.log.debug('BlockUntilMs too small %d is less than %d', blockUntilMs, this.transport.timing.foregroundRefreshMs);
      blockUntilMs = this.transport.timing.foregroundRefreshMs;
      nextUpdateInMs = this.transport.timing.foregroundRefreshMs;
    } else {
      nextUpdateInMs = this.transport.timing.backgroundRefreshMs;
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

  private async getDevices() {
    const response = await this.transport.listDevices();
    const stableIds = resolveDeviceIds(response, this.knownDevices(), this.log);
    this._devices = new Map();
    this._transportIds = new Map();
    for (const device of response) {
      const id = stableIds.get(device.id) ?? device.id;
      this._devices.set(id, { ...device, id });
      this._transportIds.set(id, device.id);
    }
    return this._devices;
  }

  private transportId(deviceId: string): string {
    return this._transportIds.get(deviceId) ?? deviceId;
  }

  public get capabilities(): TransportCapabilities {
    return this.transport.capabilities;
  }

  public async getDeviceData(deviceId: string): Promise<ThermostatData | undefined> {
    return await this.transport.fetchData(this.transportId(deviceId));
  }

  /**
   * Hardware identity of a device, for logs and bug reports. Reported by the thermostat itself
   * rather than the device list, which doesn't say what equipment is behind it.
   */
  public describeDevice(data: ThermostatData | undefined): string {
    if (!data) {
      return 'no data available';
    }
    const parts: string[] = [];
    const thermostat = readIdField(data.statModel);
    const firmware = readIdField(data.statFirmware);
    const indoorUnit = readIdField(data.ctIFCModelNoCharacter1_15);
    const outdoorUnit = readIdField(data.ctOutdoorModelNoCharacter1_15);
    if (thermostat) {
      parts.push(`thermostat ${thermostat}`);
    }
    if (firmware) {
      parts.push(`firmware ${firmware}`);
    }
    if (indoorUnit) {
      parts.push(`indoor unit ${indoorUnit}`);
    }
    if (outdoorUnit) {
      parts.push(`outdoor unit ${outdoorUnit}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'unidentified equipment';
  }

  /**
   * A One+ thermostat payload always carries at least one of these. A payload with none of
   * them comes from a different kind of device (a mini split, for example), whose fields this
   * plugin can't read - caching it would push undefined values into every characteristic.
   */
  private isRecognizedData(device: Thermostat, data: ThermostatData): boolean {
    const coreFields = ['mode', 'tempIndoor', 'hspActive', 'cspActive'] as const;
    if (coreFields.some(field => data[field] !== undefined)) {
      return true;
    }

    if (!this._unsupportedDevices.has(device.id)) {
      this._unsupportedDevices.add(device.id);
      const fields = Object.keys(data);
      this.log.warn(
        'Device %s [%s] returned data in an unrecognized format and will not be updated. This plugin supports the ' +
          'Daikin One+ thermostat, but only a subset of devices the thermostat works with; other devices such as ' +
          'mini splits are not yet supported. See ' +
          'https://github.com/jeffschubert/homebridge-daikin-oneplus/issues/56 to help add support. ' +
          'Received %d fields, starting with: %s',
        device.id,
        device.name,
        fields.length,
        fields.slice(0, 20).join(', '),
      );
    }
    return false;
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
    return this.getTargetTempFromData(data);
  }

  private getTargetTempFromData(data: ThermostatData | undefined): number {
    if (!data) return -270;
    switch (data.mode) {
      case ThermostatMode.HEAT:
      case ThermostatMode.EMERGENCY_HEAT:
      case ThermostatMode.AUTO:
        return data.hspActive ?? -270;
      case ThermostatMode.COOL:
      default:
        return data.cspActive ?? -270;
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

  public getZoneValue(deviceId: string, zone: number, field: string): number {
    const data = this._devices.get(deviceId)?.data;
    if (
      !data ||
      Date.now() - (this.readTimes.get(deviceId) ?? 0) > this.staleAfterMs ||
      (zone > 1 ? data[`Zone${zone}Enable`] !== 1 : data.Zone1Enable !== undefined && data.Zone1Enable !== 1)
    ) {
      throw new Error('Zone data unavailable or expired');
    }
    const value = data[zoneField(zone, field)];
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 255) throw new Error(`Zone ${zone}: ${field} unavailable`);
    return value;
  }

  private async queueZoneWrite(deviceId: string, zone: number, action: () => Promise<boolean>): Promise<boolean> {
    if (zone > 1 && !this.enableAdditionalZoneControls) {
      return Promise.reject(new Error('Additional-zone controls are disabled. enableAdditionalZoneControls requires hardware validation.'));
    }
    const key = zoneIdentity(deviceId, zone);
    const previous = this.zoneWrites.get(key) ?? Promise.resolve(true);
    const next = (async () => {
      try {
        await previous;
      } catch {
        /* A failed edit must not block later edits. */
      }
      return action();
    })();
    this.zoneWrites.set(key, next);
    try {
      return await next;
    } finally {
      if (this.zoneWrites.get(key) === next) this.zoneWrites.delete(key);
    }
  }

  public async setTargetTemps(
    deviceId: string,
    targetTemp?: number,
    heatThreshold?: number,
    coolThreshold?: number,
    zone = 1,
  ): Promise<boolean> {
    return this.queueZoneWrite(deviceId, zone, async () => {
      const mode = this.getZoneValue(deviceId, zone, 'mode');
      let values: ThermostatUpdate;
      if (mode === ThermostatMode.AUTO) {
        if (targetTemp !== undefined) return true;
        const heat = heatThreshold ?? this.getZoneValue(deviceId, zone, 'hspActive');
        const cool = coolThreshold ?? this.getZoneValue(deviceId, zone, 'cspActive');
        if (!Number.isFinite(heat) || !Number.isFinite(cool) || heat > cool || heat === 255 || cool === 255) return false;
        values = { hspHome: heat, cspHome: cool };
      } else if (mode === ThermostatMode.HEAT || mode === ThermostatMode.EMERGENCY_HEAT) {
        if (targetTemp === undefined) return true;
        values = { hspHome: targetTemp };
      } else if (mode === ThermostatMode.COOL) {
        if (targetTemp === undefined) return true;
        values = { cspHome: targetTemp };
      } else return mode === ThermostatMode.OFF;
      if (Object.values(values).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 50))
        return false;
      const data = this._devices.get(deviceId)!.data!;
      if (this.transport.capabilities.schedule) {
        const schedule = data[zoneField(zone, 'schedEnabled')];
        if (schedule === undefined || schedule === 255) throw new Error('Zone schedule state unavailable');
        if (schedule === true || schedule === 1) values.schedOverride = 1;
      }
      const success = await this.putRequest(deviceId, zoneUpdate(zone, values), 'setTargetTemps', 'Error updating zone temperatures:');
      if (success) {
        const derived: ThermostatUpdate = {};
        if (values.hspHome !== undefined) derived.hspActive = values.hspHome;
        if (values.cspHome !== undefined) derived.cspActive = values.cspHome;
        this._updateCache(deviceId, zoneUpdate(zone, derived));
      }
      return success;
    });
  }

  public async setTargetState(deviceId: string, requestedState: ThermostatMode, zone = 1): Promise<boolean> {
    return this.queueZoneWrite(deviceId, zone, async () => {
      this.getZoneValue(deviceId, zone, 'mode');
      return this.putRequest(deviceId, zoneUpdate(zone, { mode: requestedState }), 'setTargetState', 'Error updating zone mode:');
    });
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
        //  schedOverride must be cleared here too. Clearing geofencingAway and
        //  setting schedEnabled does NOT cancel an active manual or temp hold,
        //  so without this the thermostat stays parked on the held setpoint
        //  and never returns to the schedule the user just asked to resume.
        requestedData = {
          geofencingAway: false,
          schedOverride: 0,
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
    this.writeGeneration++;
    this.activeWrites++;
    try {
      return await this.performPutRequest(deviceId, requestData, caller, errorHeader);
    } finally {
      this.activeWrites--;
      this._scheduleUpdate(this.transport.timing.writeDelayMs);
    }
  }

  private async performPutRequest(deviceId: string, requestData: ThermostatUpdate, caller: string, errorHeader: string): Promise<boolean> {
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

    try {
      if (!(await this.transport.write(this.transportId(deviceId), requestData))) {
        this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
        return false;
      }

      this.log.debug('%s-> device: %s; write accepted', caller, deviceId);
      this._lastWriteFinishTimeMs = this._monotonic_clock_ms();
      this.log.debug(
        'WF: %d ; %d ; GT: %d ; %d',
        this._lastWriteStartTimeMs,
        this._lastWriteFinishTimeMs,
        this._lastReadStartTimeMs,
        this._lastReadFinishTimeMs,
      );
      this._updateCache(deviceId, requestData);
      this._scheduleUpdate(this.transport.timing.writeDelayMs);
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
    if (this.logRaw) {
      this.log.debug('Updated cache for %s: %s', deviceId, JSON.stringify(partialUpdate));
    }
    this.log.debug('Updated cache for %s', deviceId);
  }

  private logError(message: string, error: unknown): boolean {
    return logError(this.log, message, error);
  }
}
