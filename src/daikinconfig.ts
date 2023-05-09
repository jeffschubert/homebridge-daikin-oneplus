// Plugin configuration options.
export interface DaikinOptionsInterface {
  debug: boolean,
  user: string,
  password: string,
  includeDeviceName: boolean,
  name: string,
  enableEmergencyHeatSwitch: boolean,
  enableOneCleanFan: boolean,
  enableCirculateAirFan: boolean,
  enableScheduleSwitch: boolean,
  enableAwaySwitch: boolean,
  ignoreIndoorAqi: boolean,
  ignoreOutdoorAqi: boolean,
  ignoreIndoorHumSensor: boolean,
  ignoreOutdoorHumSensor: boolean,
  ignoreThermostat: boolean,
  autoResumeSchedule: boolean,
  }
  
export type DaikinOptions = Readonly<DaikinOptionsInterface>;