import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * One Clean Fan
 * Fan can either be on (clean requested for 3 hours) or off
 */
export class DaikinOnePlusOneCleanFan {
  private service: Service;
  CurrentState!: CharacteristicValue;

  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Fanv2)
                    || this.accessory.addService(this.platform.Service.Fanv2);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    const value = this.handleActiveGet();
    this.service.updateCharacteristic(this.platform.Characteristic.Active, value);
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleActiveGet() {
    return this.daikinApi.deviceHasData(this.deviceId) &&
      this.daikinApi.getOneCleanFanActive(this.deviceId)
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.debug('One Clean Fan', this.accessory.displayName, '- Set One Clean Fan State:', value);
    await this.daikinApi.setOneCleanFanActive(this.deviceId, value === this.platform.Characteristic.Active.ACTIVE);
  }
}