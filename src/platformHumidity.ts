import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusHumidity {
  private service: Service;

  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
    private readonly forIndoor: boolean,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.HumiditySensor) 
                    || this.accessory.addService(this.platform.Service.HumiditySensor);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    if(this.daikinApi.deviceHasData(this.deviceId)){
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, 
        this.handleHumidityGet());
  
      this.platform.log.debug('Humidity', this.accessory.displayName, '- Updated humidity characteristics...');
    } else{
      this.platform.log.info('Humidity', this.accessory.displayName, '- Waiting for data...');
    }
  }

  /**
   * Handle requests to get the current value of the Humidity characteristic
   */
  handleHumidityGet(): CharacteristicValue {
    let currentHumidity = this.forIndoor 
      ? this.daikinApi.getCurrentHumidity(this.deviceId) 
      : this.daikinApi.getOutdoorHumidity(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(currentHumidity < 0) {
      currentHumidity = 0;
    } else if (currentHumidity > 100) {
      currentHumidity = 100;
    }
    this.platform.log.debug('Humidity', this.accessory.displayName, '- Get Humidity:', currentHumidity);
    return currentHumidity;
  }
}
