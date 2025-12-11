import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { AccessoryContext } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

/**
 * Away Mode Switch
 * A switch accessory to show and toggle the Away Mode state
 */
export class DaikinOnePlusAwaySwitch {
  private service: Service;

  public constructor(
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

    this.daikinApi.addListener(this.deviceId, this.updateValues.bind(this));
  }

  private updateValues() {
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.handleCurrentStateGet());
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  private handleCurrentStateGet(): boolean {
    const currentState = this.daikinApi.getAwayState(this.deviceId);
    this.platform.log.debug('%s - Get Away State:', this.accessory.displayName, currentState);
    return currentState;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  private async handleCurrentStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set Away State: %s', this.accessory.displayName, value);
    await this.daikinApi.setAwayState(this.deviceId, Boolean(value), this.platform.config.autoResumeSchedule);
  }
}
