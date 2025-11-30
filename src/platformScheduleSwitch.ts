import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { AccessoryContext } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusScheduleSwitch {
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
    return this.daikinApi.deviceHasData(this.deviceId) && this.daikinApi.getScheduleState(this.deviceId);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleCurrentStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set Schedule State: %s', this.accessory.displayName, value);
    await this.daikinApi.setScheduleState(this.deviceId, Boolean(value));
  }
}
