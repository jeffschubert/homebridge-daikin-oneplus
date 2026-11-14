import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { AccessoryContext, ThermostatMode } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

export class DaikinOnePlusThermostat {
  private readonly service: Service;
  private readonly listener = () => this.updateValues();
  private readonly readers = new Map<string, () => number>();

  public constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
    private readonly zone = 1,
  ) {
    const C = platform.Characteristic;
    accessory
      .getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Daikin')
      .setCharacteristic(C.Model, accessory.context.device.model)
      .setCharacteristic(C.SerialNumber, zone === 1 ? deviceId : `${deviceId}-zone-${zone}`)
      .setCharacteristic(C.FirmwareRevision, accessory.context.device.firmwareVersion);
    this.service = accessory.getService(platform.Service.Thermostat) || accessory.addService(platform.Service.Thermostat);
    this.rename(accessory.displayName);
    this.bind('CurrentTemperature', () => this.read('tempIndoor', -100, 100));
    this.bind('CurrentRelativeHumidity', () => this.read('humIndoor', 0, 100));
    this.bind('CurrentHeatingCoolingState', () => {
      const state = this.read('equipmentStatus', 1, 5);
      return state === 1 || state === 2
        ? C.CurrentHeatingCoolingState.COOL
        : state === 3
          ? C.CurrentHeatingCoolingState.HEAT
          : C.CurrentHeatingCoolingState.OFF;
    });
    this.bind(
      'TargetHeatingCoolingState',
      () => {
        const mode = this.read('mode', 0, 4);
        return mode === ThermostatMode.EMERGENCY_HEAT ? ThermostatMode.HEAT : mode;
      },
      async value => {
        let mode = Number(value);
        if (zone === 1 && mode === ThermostatMode.HEAT && daikinApi.isEmergencyHeatEnabled(deviceId)) mode = ThermostatMode.EMERGENCY_HEAT;
        return daikinApi.setTargetState(deviceId, mode, zone);
      },
    );
    this.bind(
      'TargetTemperature',
      () => {
        const mode = this.read('mode', 0, 4);
        return this.read(mode === ThermostatMode.COOL || mode === ThermostatMode.OFF ? 'cspActive' : 'hspActive', 0, 50);
      },
      value => daikinApi.setTargetTemps(deviceId, Number(value), undefined, undefined, zone),
    );
    this.bind(
      'HeatingThresholdTemperature',
      () => this.read('hspActive', 0, 50),
      value => daikinApi.setTargetTemps(deviceId, undefined, Number(value), undefined, zone),
    );
    this.bind(
      'CoolingThresholdTemperature',
      () => this.read('cspActive', 0, 50),
      value => daikinApi.setTargetTemps(deviceId, undefined, undefined, Number(value), zone),
    );
    this.updateValues();
    this.service.getCharacteristic(C.TargetTemperature).setProps({ minStep: 0.5 });
    this.service.getCharacteristic(C.HeatingThresholdTemperature).setProps({ minValue: 10, maxValue: 30, minStep: 0.1 });
    this.service.getCharacteristic(C.CoolingThresholdTemperature).setProps({ minValue: 12, maxValue: 32, minStep: 0.1 });
    // Display units and humidification controls are only supported on the physical/main thermostat.
    this.bind(
      'TemperatureDisplayUnits',
      () => daikinApi.getDisplayUnits(deviceId),
      async value => {
        if (zone > 1) throw new Error('Display units are a shared equipment setting; use the main thermostat');
        return daikinApi.setDisplayUnits(deviceId, Number(value));
      },
    );
    if (zone === 1)
      this.bind(
        'TargetRelativeHumidity',
        () => this.read('humSP', 0, 100),
        value => daikinApi.setTargetHumidity(deviceId, Number(value)),
      );
    daikinApi.addListener(deviceId, this.listener);
  }

  public rename(name: string): void {
    this.accessory.displayName = name;
    this.service.setCharacteristic(this.platform.Characteristic.Name, name);
  }

  public destroy(): void {
    this.daikinApi.removeListener(this.deviceId, this.listener);
  }

  private read(field: string, min: number, max: number): number {
    const value = this.daikinApi.getZoneValue(this.deviceId, this.zone, field);
    if (value < min || value > max) throw new Error(`Zone ${this.zone}: invalid ${field}`);
    return value;
  }

  private bind(name: string, read: () => number, write?: (value: CharacteristicValue) => Promise<boolean>): void {
    const type = this.platform.Characteristic[
      name as keyof typeof this.platform.Characteristic
    ] as typeof this.platform.Characteristic.CurrentTemperature;
    const characteristic = this.service.getCharacteristic(type);
    const safeRead = () => {
      try {
        return read();
      } catch {
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    };
    this.readers.set(name, safeRead);
    characteristic.onGet(() => {
      this.daikinApi.updateNow();
      return safeRead();
    });
    if (write)
      characteristic.onSet(async value => {
        try {
          if (!(await write(value))) throw new Error('Daikin rejected zone update');
        } catch (error) {
          this.platform.log.warn('Zone %d control failed: %s', this.zone, String(error));
          throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
  }

  private updateValues(): void {
    try {
      const mode = this.read('mode', 0, 4);
      const target = this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature);
      if (mode === ThermostatMode.HEAT || mode === ThermostatMode.EMERGENCY_HEAT) target.setProps({ minValue: 10, maxValue: 30 });
      if (mode === ThermostatMode.COOL) target.setProps({ minValue: 12, maxValue: 32 });
    } catch {
      /* Unavailable values are reported on each characteristic below. */
    }
    for (const [name, read] of this.readers) {
      const type = this.platform.Characteristic[
        name as keyof typeof this.platform.Characteristic
      ] as typeof this.platform.Characteristic.CurrentTemperature;
      try {
        this.service.updateCharacteristic(type, read());
      } catch {
        this.service.updateCharacteristic(
          type,
          new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE),
        );
      }
    }
  }
}
