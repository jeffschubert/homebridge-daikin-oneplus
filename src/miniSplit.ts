import { EquipmentStatus, TemperatureUnit, ThermostatData, ThermostatMode, ThermostatUpdate } from './types.js';

/**
 * Mini split support.
 *
 * Mini split adapters answer /deviceData with an entirely different payload than a One+
 * thermostat: `idu*` fields for the indoor unit, `odu*` for the outdoor unit, `adpt*` for the
 * wifi adapter itself. Rather than give them a parallel set of accessory classes, this module
 * translates that payload into the `ThermostatData` shape the rest of the plugin already reads,
 * and translates writes back on the way out. Everything downstream of `DaikinApi` is unaware
 * that mini splits exist.
 *
 * Field mapping courtesy of @emmeram's capture in
 * https://github.com/jeffschubert/homebridge-daikin-oneplus/issues/56.
 */

/**
 * Raw mini split payload. Only the fields the plugin reads or writes are declared; the adapter
 * returns roughly 150 more.
 */
export interface MiniSplitData {
  /** Indoor unit power state */
  iduOnOff?: boolean;
  /**
   * Indoor unit operating mode, numbered the same as ThermostatMode. In the issue #56 capture
   * this was 2 while iduTargetTemp matched iduCoolSetpoint rather than iduHeatSetpoint, which
   * agrees with ThermostatMode.COOL. Values outside the enum are treated as off.
   */
  iduOperatingMode?: ThermostatMode;
  /** Current room temperature in Celsius */
  iduRoomTemp?: number;
  /** Setpoint for the active mode in Celsius */
  iduTargetTemp?: number;
  /** Cooling setpoint in Celsius */
  iduCoolSetpoint?: number;
  /** Heating setpoint in Celsius */
  iduHeatSetpoint?: number;
  /** Target relative humidity */
  iduTargetHumidity?: number;
  /** Whether the indoor unit is actively calling for conditioning */
  iduThermoState?: boolean;
  /** Outdoor temperature in Celsius */
  oduOutdoorTemp?: number;
  /** Whether the outdoor compressor is running */
  oduCompOnOff?: boolean;
  /** Whether a schedule is active */
  schedEnabled?: boolean;
  /** Adapter firmware type, e.g. 'wlan_adp_gen4' */
  adptFWtype?: string;
  /** Adapter software version */
  adptSWversion?: string;
}

/** Whether a /deviceData payload came from a mini split adapter rather than a One+ thermostat. */
export const isMiniSplitData = (data: object): boolean => {
  const miniSplit = data as MiniSplitData;
  return miniSplit.iduRoomTemp !== undefined || miniSplit.iduOperatingMode !== undefined;
};

/** Hardware identity of a mini split, for logs and bug reports. */
export const describeMiniSplit = (data: object): string => {
  const { adptFWtype, adptSWversion } = data as MiniSplitData;
  const parts = ['mini split'];
  if (adptFWtype) {
    parts.push(`adapter ${adptFWtype}`);
  }
  if (adptSWversion) {
    parts.push(`adapter software ${adptSWversion}`);
  }
  return parts.join(', ');
};

const toThermostatMode = (data: MiniSplitData): ThermostatMode => {
  if (!data.iduOnOff) {
    return ThermostatMode.OFF;
  }
  switch (data.iduOperatingMode) {
    case ThermostatMode.HEAT:
    case ThermostatMode.COOL:
    case ThermostatMode.AUTO:
    case ThermostatMode.EMERGENCY_HEAT:
      return data.iduOperatingMode;
    default:
      return ThermostatMode.OFF;
  }
};

const toEquipmentStatus = (data: MiniSplitData, mode: ThermostatMode): EquipmentStatus => {
  // iduThermoState is the unit's own "currently conditioning" flag; the compressor covers the
  // case where the indoor unit reports idle mid-cycle.
  if (mode === ThermostatMode.OFF || !(data.iduThermoState || data.oduCompOnOff)) {
    return EquipmentStatus.IDLE;
  }
  switch (mode) {
    case ThermostatMode.HEAT:
    case ThermostatMode.EMERGENCY_HEAT:
      return EquipmentStatus.HEATING;
    case ThermostatMode.COOL:
      return EquipmentStatus.COOLING;
    default:
      // In auto the payload doesn't say which way a running unit is working, so go by the
      // setpoint the room has moved past.
      return inferAutoEquipmentStatus(data);
  }
};

const inferAutoEquipmentStatus = (data: MiniSplitData): EquipmentStatus => {
  const room = data.iduRoomTemp;
  if (room === undefined) {
    return EquipmentStatus.IDLE;
  }
  if (data.iduCoolSetpoint !== undefined && room > data.iduCoolSetpoint) {
    return EquipmentStatus.COOLING;
  }
  if (data.iduHeatSetpoint !== undefined && room < data.iduHeatSetpoint) {
    return EquipmentStatus.HEATING;
  }
  return EquipmentStatus.IDLE;
};

/**
 * Overlay One+ field names onto a mini split payload. The raw fields are kept so that history
 * recording and raw logging still see everything the adapter sent.
 */
export const normalizeMiniSplitData = (data: object): ThermostatData => {
  const miniSplit = data as MiniSplitData;
  const mode = toThermostatMode(miniSplit);

  return {
    ...data,
    mode: mode,
    equipmentStatus: toEquipmentStatus(miniSplit, mode),
    // Mini splits report Celsius only and offer no display unit setting.
    units: TemperatureUnit.CELSIUS,
    tempIndoor: miniSplit.iduRoomTemp,
    tempOutdoor: miniSplit.oduOutdoorTemp,
    hspActive: miniSplit.iduHeatSetpoint,
    hspHome: miniSplit.iduHeatSetpoint,
    cspActive: miniSplit.iduCoolSetpoint,
    cspHome: miniSplit.iduCoolSetpoint,
    humSP: miniSplit.iduTargetHumidity,
    schedEnabled: miniSplit.schedEnabled,
    // No geofencing, no manual hold, and no aux heat on a mini split.
    schedOverride: 0,
    geofencingAway: false,
    modeEmHeatAvailable: false,
  } as ThermostatData;
};

/** Inverse of toThermostatMode. Returns undefined for OFF, which the adapter expresses as iduOnOff. */
const toMiniSplitMode = (mode: ThermostatMode): ThermostatMode | undefined => {
  switch (mode) {
    case ThermostatMode.HEAT:
    case ThermostatMode.COOL:
    case ThermostatMode.AUTO:
      return mode;
    // A mini split has no aux heat element, so emergency heat is just heat.
    case ThermostatMode.EMERGENCY_HEAT:
      return ThermostatMode.HEAT;
    default:
      return undefined;
  }
};

/**
 * Translate a write from One+ field names back to mini split ones. Fields the adapter has no
 * equivalent for are dropped and returned in `unsupported` so the caller can say so.
 */
export const toMiniSplitUpdate = (update: ThermostatUpdate): { data: MiniSplitData; unsupported: string[] } => {
  const data: MiniSplitData = {};
  const unsupported: string[] = [];

  for (const [field, value] of Object.entries(update)) {
    switch (field) {
      case 'mode': {
        const requested = toMiniSplitMode(value as ThermostatMode);
        data.iduOnOff = requested !== undefined;
        if (requested !== undefined) {
          data.iduOperatingMode = requested;
        }
        break;
      }
      case 'hspHome':
      case 'hspActive':
        data.iduHeatSetpoint = value as number;
        break;
      case 'cspHome':
      case 'cspActive':
        data.iduCoolSetpoint = value as number;
        break;
      case 'humSP':
        data.iduTargetHumidity = value as number;
        break;
      case 'schedEnabled':
        data.schedEnabled = value as boolean;
        break;
      // Silently dropped: the plugin sets these alongside supported fields rather than on their
      // own, and a mini split simply has no such concept.
      case 'schedOverride':
      case 'geofencingAway':
        break;
      default:
        unsupported.push(field);
        break;
    }
  }

  return { data: data, unsupported: unsupported };
};
