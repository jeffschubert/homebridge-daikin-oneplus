/**
 * Operating mode for the thermostat.
 * Maps to HomeKit's TargetHeatingCoolingState.
 */
export const enum ThermostatMode {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3,
  EMERGENCY_HEAT = 4,
}

/**
 * Equipment running status.
 * Indicates what the HVAC system is currently doing.
 */
export const enum EquipmentStatus {
  COOLING = 1,
  OVERCOOL_DEHUMIDIFYING = 2,
  HEATING = 3,
  FAN = 4,
  IDLE = 5,
}

/**
 * Fan circulation mode setting.
 */
export const enum FanCirculateMode {
  OFF = 0,
  ALWAYS_ON = 1,
  SCHEDULE = 2,
}

/**
 * Temperature display units.
 */
export const enum TemperatureUnit {
  FAHRENHEIT = 0,
  CELSIUS = 1,
}

/**
 * Air quality level (0 = best, 3 = worst).
 */
export const enum AirQualityLevel {
  GOOD = 0,
  FAIR = 1,
  INFERIOR = 2,
  POOR = 3,
}

/**
 * Basic device information returned from the /devices endpoint.
 * Contains static device metadata that doesn't change during runtime.
 */
interface ThermostatInfo {
  /** Unique device identifier (UUID format) */
  id: string;
  /** User-assigned device name */
  name: string;
  /** Device model number */
  model: string;
  /** Current firmware version */
  firmwareVersion: string;
}

/**
 * Device information with optional cached data.
 * Data is populated after getDeviceData call and may be undefined
 * between device discovery and first data fetch.
 */
export interface Thermostat extends ThermostatInfo {
  /** Cached device data (undefined until getDeviceData is called) */
  data?: ThermostatData;
}

/**
 * Device data returned from the /deviceData/{id} endpoint.
 * This is the main data structure containing thermostat state.
 *
 * Field documentation sourced from:
 * https://github.com/apetrycki/daikinskyport/blob/master/API_info.md
 *
 * Note: This plugin uses the undocumented Skyport API (api.daikinskyport.com),
 * which is the same API used by the Daikin One Home mobile app.
 */
export interface ThermostatData {
  // === Operating Mode & Status ===

  /** Current operating mode (0=off, 1=heat, 2=cool, 3=auto, 4=emergency heat) */
  mode: ThermostatMode;
  /** Equipment running status (1=cooling, 2=overcool dehumidifying, 3=heating, 4=fan, 5=idle) */
  equipmentStatus: EquipmentStatus;
  /** Temperature display units (0=Fahrenheit, 1=Celsius) */
  units: TemperatureUnit;

  // === Temperature Readings ===

  /** Current indoor temperature in Celsius */
  tempIndoor: number;
  /** Current outdoor temperature in Celsius */
  tempOutdoor: number;

  // === Temperature Setpoints ===
  // The Daikin API has separate setpoints for different modes:
  // - *Home: setpoint for "home" mode
  // - *Away: setpoint for "away" mode
  // - *Sched: setpoint from active schedule
  // - *Active: currently active setpoint (whichever mode is in effect)

  /** Heating setpoint for "home" mode in Celsius (writable) */
  hspHome: number;
  /** Cooling setpoint for "home" mode in Celsius (writable) */
  cspHome: number;
  /** Currently active heating setpoint in Celsius (read-only, derived from mode) */
  hspActive: number;
  /** Currently active cooling setpoint in Celsius (read-only, derived from mode) */
  cspActive: number;
  /** Heating setpoint from schedule in Celsius */
  hspSched?: number;
  /** Cooling setpoint from schedule in Celsius */
  cspSched?: number;
  /** Heating setpoint for "away" mode in Celsius */
  hspAway?: number;
  /** Cooling setpoint for "away" mode in Celsius */
  cspAway?: number;

  // === Humidity ===

  /** Current indoor humidity percentage (0-100) */
  humIndoor: number;
  /** Current outdoor humidity percentage (0-100) */
  humOutdoor: number;
  /** Target humidity setpoint percentage (writable) */
  humSP: number;
  /** Dehumidification setpoint percentage */
  dehumSP?: number;

  // === Schedule & Away Mode ===

  /** Whether schedule mode is enabled */
  schedEnabled: boolean;
  /** Schedule override (0=following schedule, 1=temporary hold) */
  schedOverride: number;
  /** Schedule override duration in minutes */
  schedOverrideDuration?: number;
  /** Whether geofencing away mode is active */
  geofencingAway: boolean;
  /** Whether geofencing is enabled */
  geofencingEnabled?: boolean;

  // === Fan Settings ===

  /** Fan circulation mode (0=off, 1=always on, 2=schedule) */
  fanCirculate: FanCirculateMode;
  /** Fan circulation speed setting */
  fanCirculateSpeed: number;
  /** Whether fan circulation is currently active */
  fanCirculateActive?: boolean;
  /** Fan circulation duration per hour (0=full, 1=5min, 2=15min, 3=30min, 4=45min) */
  fanCirculateDuration?: number;

  // === One Clean (Air Cleaning) ===

  /** Whether One Clean fan cycle is active */
  oneCleanFanActive: boolean;
  /** One Clean fan speed */
  oneCleanFanSpeed?: number;
  /** One Clean duration in hours */
  oneCleanFanDuration?: number;
  /** Particulate threshold to trigger air cleaning */
  oneCleanParticleTrigger?: number;

  // === Air Quality ===

  /** Whether indoor air quality sensor is available */
  aqIndoorAvailable?: boolean;
  /** Whether outdoor air quality data is available */
  aqOutdoorAvailable?: boolean;
  /** Indoor air quality level (0=good, 1=fair, 2=inferior, 3=poor) */
  aqIndoorLevel: AirQualityLevel;
  /** Outdoor air quality level (0=good, 1=fair, 2=inferior, 3=poor) */
  aqOutdoorLevel: AirQualityLevel;
  /** Indoor AQI value/score */
  aqIndoorValue: number;
  /** Outdoor AQI value/score */
  aqOutdoorValue: number;
  /** Indoor particulate concentration (μg/m³) */
  aqIndoorParticlesValue: number;
  /** Outdoor particulate concentration (μg/m³) */
  aqOutdoorParticles: number;
  /** Indoor VOC value */
  aqIndoorVOCValue: number;
  /** Indoor VOC level */
  aqIndoorVOCLevel?: number;
  /** Indoor particle level */
  aqIndoorParticlesLevel?: number;
  /** Outdoor ozone concentration (ppb) */
  aqOutdoorOzone: number;

  // === System Capabilities ===

  /** Whether emergency heat mode is available */
  modeEmHeatAvailable?: boolean;
  /** Whether heat pump is available */
  ctSystemCapCompressorHeat?: boolean;
  /** Whether A/C is available */
  ctSystemCapCool?: boolean;
  /** Whether any heat source is available */
  ctSystemCapHeat?: boolean;
  /** Whether gas heat is available */
  ctSystemCapGasHeat?: boolean;
  /** Whether electric heating element is installed */
  ctSystemCapElectricHeat?: boolean;
  /** Whether emergency heat element is installed */
  ctSystemCapEmergencyHeat?: boolean;
  /** Whether dehumidification is available */
  ctSystemCapDehumidification?: boolean;
  /** Whether humidity control is available */
  ctSystemCapHumidification?: boolean;
  /** Whether exterior ventilation is available */
  ctSystemCapVentilation?: boolean;
  /** Number of cooling stages */
  ctOutdoorNoofCoolStages?: number;
  /** Number of heating stages */
  ctOutdoorNoofHeatStages?: number;
}

/**
 * Partial device data for cache updates.
 * Used when updating specific fields after a write operation.
 */
export type ThermostatUpdate = Partial<ThermostatData>;

/**
 * Context stored on each Homebridge accessory.
 * Used to persist device information across restarts.
 */
export interface AccessoryContext {
  device: Thermostat;
}

/**
 * Plugin configuration options.
 */
export interface DaikinOptions {
  debug: boolean;
  user: string;
  password: string;
  includeDeviceName: boolean;
  name: string;
  enableEmergencyHeatSwitch: boolean;
  enableOneCleanFan: boolean;
  enableCirculateAirFan: boolean;
  enableScheduleSwitch: boolean;
  enableAwaySwitch: boolean;
  ignoreIndoorAqi: boolean;
  ignoreOutdoorAqi: boolean;
  ignoreIndoorHumSensor: boolean;
  ignoreOutdoorHumSensor: boolean;
  ignoreThermostat: boolean;
  ignoreOutdoorTemp: boolean;
  autoResumeSchedule: boolean;
  logRaw: boolean;
}
