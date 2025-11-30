import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { AccessoryContext, ThermostatMode } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

/**
 * Emergency Heat Switch
 * Unfortunately HomeKit does not support an "emergency heat" or "auxiliary heat" mode directly,
 * so the code works around that by exposing a switch to both control and show the emergency heat
 * status. "On" means auxiliary heat is being requested by the thermostat.
 */
export class DaikinOnePlusEmergencyHeatSwitch {
  private service: Service;

  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
  ) {
    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        this.daikinApi.updateNow();
        return this.handleCurrentStateGet();
      })
      .onSet(this.handleCurrentStateSet.bind(this));

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    const value = this.handleCurrentStateGet();
    this.service.updateCharacteristic(this.platform.Characteristic.On, value);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleCurrentStateGet(): boolean {
    const currentState =
      this.daikinApi.deviceHasData(this.deviceId) && this.daikinApi.getTargetState(this.deviceId) === ThermostatMode.EMERGENCY_HEAT;
    this.platform.log.debug('%s - Get Emergency Heat State: %s', this.accessory.displayName, currentState);
    return currentState;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleCurrentStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set Emergency Heat State: %s', this.accessory.displayName, value);
    await this.daikinApi.setTargetState(this.deviceId, value ? ThermostatMode.EMERGENCY_HEAT : ThermostatMode.HEAT);
  }
}
