import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusAwaySwitch {
  private service: Service;
  CurrentState!: CharacteristicValue;
  
  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
    private readonly displayName: string,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Switch) 
                    || this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(()=>{
        return this.CurrentState!;
      })
      .onSet(this.handleCurrentStateSet.bind(this));

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    // push the new value to HomeKit
    if(this.daikinApi.deviceHasData(this.deviceId)){
      this.CurrentState = this.handleCurrentStateGet();
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.handleCurrentStateGet());
      if (this.CurrentState !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.On, this.CurrentState);
      }
      this.platform.log.debug('Away', this.accessory.displayName, '- Updated Away characteristics...');
    } else{
      this.platform.log.info('Away', this.accessory.displayName, '- Waiting for data...');
    }
  }

  /**
   * Handle requests to get the current value of the "On" characteristic
   */
  handleCurrentStateGet(): boolean {
    const currentAwayState = this.daikinApi.getAwayState(this.deviceId);

    let currentValue = false;
    if(currentAwayState === true){
      currentValue = true;
    }

    this.platform.log.debug('Away', this.accessory.displayName, '- Get Away State:', currentValue);
    return currentValue;
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  async handleCurrentStateSet(value: CharacteristicValue) {
    this.platform.log.debug('Away', this.accessory.displayName, '- Set Away State:', value);
    this.CurrentState = value;
    await this.daikinApi.setAwayState(this.deviceId, Boolean(value));
  }
  
}
