import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { EquipmentStatus } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

/**
 * State Switch
 * A switch accessory showing whether the thermostat is currently in the specified state.
 */
export class DaikinOnePlusStateSwitch {
  private service: Service;

  public constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
    private readonly switchType: EquipmentStatus,
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
    this.daikinApi.addListener(this.deviceId, this.updateValues.bind(this));
  }

  private updateValues() {
    const value = this.handleCurrentStateGet();
    this.service.updateCharacteristic(this.platform.Characteristic.On, value);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  private handleCurrentStateGet(): boolean {
    const currentStatus = this.daikinApi.getCurrentStatus(this.deviceId);
    const isOn = currentStatus === this.switchType;
    this.platform.log.debug('%s - Get CurrentState:', this.accessory.displayName, isOn);
    return isOn;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  private handleCurrentStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Changing state is not allowed.', this.accessory.displayName);
    setTimeout(() => this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(!value), 1000);
  }
}
