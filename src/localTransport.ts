import { Logging } from 'homebridge';
import { EquipmentStatus, LocalDeviceConfig, Thermostat, ThermostatData, ThermostatUpdate } from './types.js';
import { DaikinTransport, TransportCapabilities, TransportTiming, logError } from './daikinTransport.js';

/** GET / */
interface LocalIdentity {
  api_ver: number;
  type: string;
  model: string;
  brand: string;
  firmware: string;
}

/** GET /query/info. Temperatures are always Celsius. */
interface LocalInfo {
  name: string;
  mode: number;
  availableModes?: number[];
  state: number;
  fan: number;
  fanState: number;
  tempUnits: number;
  spaceTemp: number;
  heatSetpoint: number;
  coolSetpoint: number;
  coolSetpointMax: number;
  coolSetpointMin: number;
  heatSetpointMax: number;
  heatSetpointMin: number;
  setpointDelta: number;
  spaceHum: number;
}

interface LocalDevice {
  baseUrl: string;
  identity: LocalIdentity;
  thermostat: Thermostat;
}

const LOCAL_TIMING: TransportTiming = {
  writeDelayMs: 2 * 1000,
  foregroundRefreshMs: 5 * 1000,
  backgroundRefreshMs: 60 * 1000,
};

const LOCAL_CAPABILITIES: TransportCapabilities = {
  outdoorSensors: false,
  schedule: false,
  away: false,
  oneClean: false,
  circulateFanSpeed: false,
  targetHumidity: false,
};

const REQUEST_TIMEOUT_MS = 5 * 1000;

const SUPPORTED_API_VERSION = 1;

// Local states 6/7 (waiting to cool/heat) and 8 (aux heat) have no cloud equivalent.
const EQUIPMENT_STATUS: Record<number, EquipmentStatus> = {
  1: EquipmentStatus.COOLING,
  2: EquipmentStatus.OVERCOOL_DEHUMIDIFYING,
  3: EquipmentStatus.HEATING,
  4: EquipmentStatus.FAN,
  5: EquipmentStatus.IDLE,
  6: EquipmentStatus.IDLE,
  7: EquipmentStatus.IDLE,
  8: EquipmentStatus.HEATING,
};

const CONTROL_FIELDS: Partial<Record<keyof ThermostatData, string>> = {
  mode: 'mode',
  hspHome: 'heatSetpoint',
  cspHome: 'coolSetpoint',
  fanCirculate: 'fan',
};

const SETTINGS_FIELDS: Partial<Record<keyof ThermostatData, string>> = {
  units: 'tempUnits',
};

const isErrorResponse = (body: unknown): body is { error: true; reason?: string } =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === true;

/**
 * Transport for the Daikin One Local API, served by the thermostat itself on the LAN. It has no
 * authentication and covers only basic mode, setpoint, fan and unit control.
 */
export class LocalTransport implements DaikinTransport {
  public readonly timing = LOCAL_TIMING;
  public readonly capabilities = LOCAL_CAPABILITIES;

  private _devices: Map<string, LocalDevice> = new Map();

  public constructor(
    private readonly configs: LocalDeviceConfig[],
    private readonly log: Logging,
  ) {}

  public async initialize(): Promise<boolean> {
    this._devices.clear();
    for (const config of this.configs) {
      const device = await this.probe(config);
      if (device) {
        this._devices.set(device.thermostat.id, device);
      }
    }
    if (this._devices.size === 0) {
      this.log.error('No configured thermostats responded to the local API.');
      return false;
    }
    if (this._devices.size < this.configs.length) {
      this.log.warn('Some configured thermostats did not respond and will not be loaded until Homebridge restarts.');
    }
    return true;
  }

  public listDevices(): Promise<Thermostat[]> {
    return Promise.resolve([...this._devices.values()].map(device => device.thermostat));
  }

  public async fetchData(deviceId: string): Promise<ThermostatData | undefined> {
    const device = this._devices.get(deviceId);
    if (!device) {
      this.log.error('No local thermostat configured for device: %s', deviceId);
      return undefined;
    }
    const info = await this.getJson<LocalInfo>(`${device.baseUrl}/query/info`);
    return info ? this.toThermostatData(device.identity, info) : undefined;
  }

  public async write(deviceId: string, update: ThermostatUpdate): Promise<boolean> {
    const device = this._devices.get(deviceId);
    if (!device) {
      this.log.error('No local thermostat configured for write request: %s', deviceId);
      return false;
    }

    const control = new URLSearchParams();
    const settings = new URLSearchParams();
    const unsupported: string[] = [];
    for (const [field, value] of Object.entries(update)) {
      const key = field as keyof ThermostatData;
      if (CONTROL_FIELDS[key]) {
        control.set(CONTROL_FIELDS[key], String(value));
      } else if (SETTINGS_FIELDS[key]) {
        settings.set(SETTINGS_FIELDS[key], String(value));
      } else {
        unsupported.push(field);
      }
    }
    if (unsupported.length > 0) {
      this.log.warn('The local API cannot set %s on %s.', unsupported.join(', '), device.thermostat.name);
      return false;
    }

    if (control.size > 0 && !(await this.post(`${device.baseUrl}/control`, control))) {
      return false;
    }
    if (settings.size > 0 && !(await this.post(`${device.baseUrl}/settings`, settings))) {
      return false;
    }
    return true;
  }

  private async probe(config: LocalDeviceConfig): Promise<LocalDevice | undefined> {
    const baseUrl = `http://${config.host}:${config.port}`;
    const identity = await this.getJson<LocalIdentity>(`${baseUrl}/`);
    const info = identity ? await this.getJson<LocalInfo>(`${baseUrl}/query/info`) : undefined;
    if (!identity || !info) {
      this.log.error('Thermostat at %s did not respond. Check that its Local API is turned on.', baseUrl);
      return undefined;
    }
    if (identity.api_ver !== SUPPORTED_API_VERSION) {
      this.log.warn(
        'Thermostat at %s reports local API version %s; this plugin was built for version %d.',
        baseUrl,
        identity.api_ver,
        SUPPORTED_API_VERSION,
      );
    }
    this.log.info('Found local thermostat %s at %s (%s, firmware %s).', info.name, baseUrl, identity.model, identity.firmware);
    return {
      baseUrl,
      identity,
      thermostat: {
        id: config.deviceId ?? `local-${config.host}`,
        name: info.name,
        model: identity.model,
        firmwareVersion: identity.firmware,
      },
    };
  }

  private toThermostatData(identity: LocalIdentity, info: LocalInfo): ThermostatData {
    const mapped: ThermostatUpdate = {
      mode: info.mode,
      equipmentStatus: EQUIPMENT_STATUS[info.state] ?? EquipmentStatus.IDLE,
      units: info.tempUnits,
      tempIndoor: info.spaceTemp,
      humIndoor: info.spaceHum,
      hspHome: info.heatSetpoint,
      hspActive: info.heatSetpoint,
      cspHome: info.coolSetpoint,
      cspActive: info.coolSetpoint,
      fanCirculate: info.fan,
      fanCirculateActive: info.fanState === 1,
      modeEmHeatAvailable: info.availableModes?.includes(4),
      statModel: identity.model,
      statFirmware: identity.firmware,
    };
    // Raw local fields ride along for history's raw-data recording.
    return { ...info, ...mapped } as unknown as ThermostatData;
  }

  private async getJson<T>(url: string): Promise<T | undefined> {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        logError(this.log, `Request ${url} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        return undefined;
      }
      const body: unknown = await response.json();
      if (isErrorResponse(body)) {
        this.log.error('Request %s was rejected: %s', url, body.reason ?? 'no reason given');
        return undefined;
      }
      return body as T;
    } catch (error) {
      logError(this.log, `Error with local request: ${url}`, error);
      return undefined;
    }
  }

  /** Throws on a network failure so DaikinApi reports it against the calling operation. */
  private async post(url: string, params: URLSearchParams): Promise<boolean> {
    this.log.debug('POST %s %s', url, params.toString());
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      logError(this.log, `Request ${url} failed with status ${response.status} - ${response.statusText}.`, text);
      return false;
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (isErrorResponse(body)) {
      this.log.error('Request %s was rejected: %s', url, body.reason ?? 'no reason given');
      return false;
    }
    this.log.debug('POST %s response: %s', url, text);
    return true;
  }
}
