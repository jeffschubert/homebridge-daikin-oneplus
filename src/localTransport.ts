import { Logging } from 'homebridge';
import { EquipmentStatus, LocalDeviceConfig, Thermostat, ThermostatData, ThermostatUpdate } from './types.js';
import { DaikinTransport, TransportCapabilities, TransportTiming, logError } from './daikinTransport.js';
import { DiscoveredThermostat, discoverThermostats } from './localDiscovery.js';

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
  /** Known when the device was seen via mDNS, so a changed IP address can be found again. */
  mac?: string;
  lastRediscoveryMs: number;
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

const DISCOVERY_TIMEOUT_MS = 5 * 1000;

const REDISCOVERY_INTERVAL_MS = 60 * 1000;

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
    private readonly discovery: boolean,
    private readonly log: Logging,
  ) {}

  public async initialize(): Promise<boolean> {
    this._devices.clear();
    let configuredFound = 0;
    for (const config of this.configs) {
      const device = await this.probe(config.host, config.port, config.deviceId ?? `local-${config.host}`);
      if (device) {
        this._devices.set(device.thermostat.id, device);
        configuredFound++;
      }
    }
    if (configuredFound < this.configs.length) {
      this.log.warn('Some configured thermostats did not respond and will not be loaded until Homebridge restarts.');
    }

    if (this.discovery) {
      await this.addDiscoveredDevices();
    }

    if (this._devices.size === 0) {
      this.log.error(
        this.discovery
          ? 'No thermostats found. Check that the Local API is turned on, or add thermostats by host.'
          : 'No configured thermostats responded to the local API.',
      );
      return false;
    }
    return true;
  }

  private async addDiscoveredDevices() {
    const discovered = await this.discover();
    if (discovered.length === 0) {
      this.log.info(
        'No thermostats found via mDNS. If Homebridge runs in Docker, it needs host networking for discovery; ' +
          'otherwise add thermostats by host.',
      );
      return;
    }
    for (const found of discovered) {
      if (this.isConfigured(found)) {
        const configured = [...this._devices.values()].find(
          device => device.baseUrl === `http://${found.host}:${found.port}` || device.baseUrl === `http://${found.hostname}:${found.port}`,
        );
        if (configured) {
          configured.mac = found.mac;
        }
        continue;
      }
      const device = await this.probe(found.host, found.port, `local-${found.mac.replace(/:/g, '')}`, found.mac);
      if (device) {
        this._devices.set(device.thermostat.id, device);
      }
    }
  }

  private async discover(): Promise<DiscoveredThermostat[]> {
    try {
      return await discoverThermostats(DISCOVERY_TIMEOUT_MS, this.log);
    } catch (error) {
      logError(this.log, 'mDNS discovery failed:', error);
      return [];
    }
  }

  private isConfigured(found: DiscoveredThermostat): boolean {
    return this.configs.some(config => {
      const host = config.host.toLowerCase();
      return host === found.host || host === found.hostname.toLowerCase();
    });
  }

  /** Looks a discovered device up again by MAC, at most once a minute, and follows a changed address. */
  private async rediscover(device: LocalDevice): Promise<boolean> {
    const now = Date.now();
    if (!device.mac || now - device.lastRediscoveryMs < REDISCOVERY_INTERVAL_MS) {
      return false;
    }
    device.lastRediscoveryMs = now;
    const found = (await this.discover()).find(candidate => candidate.mac === device.mac);
    if (!found) {
      return false;
    }
    const baseUrl = `http://${found.host}:${found.port}`;
    if (baseUrl === device.baseUrl) {
      return false;
    }
    this.log.info('Thermostat %s moved from %s to %s.', device.thermostat.name, device.baseUrl, baseUrl);
    device.baseUrl = baseUrl;
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
    let info = await this.getJson<LocalInfo>(`${device.baseUrl}/query/info`);
    if (!info && (await this.rediscover(device))) {
      info = await this.getJson<LocalInfo>(`${device.baseUrl}/query/info`);
    }
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

  private async probe(host: string, port: number, id: string, mac?: string): Promise<LocalDevice | undefined> {
    const baseUrl = `http://${host}:${port}`;
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
      mac,
      lastRediscoveryMs: 0,
      thermostat: {
        id,
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
