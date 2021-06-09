import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusAQSensor {
  private service: Service;
  private deviceData;
  
  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
    private readonly forIndoor: boolean,
    private readonly displayName: string,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.AirQualitySensor) 
                    || this.accessory.addService(this.platform.Service.AirQualitySensor);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    
    setInterval(async () => {
      this.deviceData = await this.daikinApi.getDeviceData(this.deviceId);
      if(!this.deviceData){
        this.platform.log.error('Unable to retrieve data.');
        return;
      }

      // push the new value to HomeKit
      this.service.updateCharacteristic(this.platform.Characteristic.AirQuality, 
        this.handleAirQualityGet(this.deviceData, forIndoor));
      if(!forIndoor){
        this.service.updateCharacteristic(this.platform.Characteristic.OzoneDensity, 
          this.handleOzoneGet(this.deviceData, forIndoor));
      }
      const aqValue = this.handleAirQualityValueGet(this.deviceData, forIndoor);
      this.service.setCharacteristic(this.platform.Characteristic.Name, `${displayName} ${aqValue}`);

      this.service.updateCharacteristic(this.platform.Characteristic.PM2_5Density, 
        this.handlePM2_5DensityGet(this.deviceData, forIndoor));

      if(forIndoor){
        this.service.updateCharacteristic(this.platform.Characteristic.VOCDensity, 
          this.handleVocDensityGet(this.deviceData, forIndoor));
      }
      this.platform.log.debug('Updated values...');
    }, this.platform.config.refreshInterval*1000);
  }

  /**
   * Handle requests to get the current value of the "Air Quality" characteristic
   */
  handleAirQualityGet(deviceData, forIndoor: boolean): CharacteristicValue {
    this.platform.log.debug('Triggered GET AirQuality');
    const currentAqLevel = this.daikinApi.getAirQualityLevel(deviceData, forIndoor);

    let currentValue = this.platform.Characteristic.AirQuality.UNKNOWN;
    switch(currentAqLevel){
      case 0:
        currentValue = this.platform.Characteristic.AirQuality.GOOD;
        break;
      case 1:
        currentValue = this.platform.Characteristic.AirQuality.FAIR;
        break;
      case 2:
        currentValue = this.platform.Characteristic.AirQuality.INFERIOR;
        break;
      case 3:
        currentValue = this.platform.Characteristic.AirQuality.POOR;
        break;
    }
    this.platform.log.debug(`GET AirQuality ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Ozone Density" characteristic
   */
  handleOzoneGet(deviceData, forIndoor:boolean): CharacteristicValue {
    this.platform.log.debug('Triggered GET Ozone');

    let currentValue = this.daikinApi.getOzone(deviceData, forIndoor);
    if(currentValue < 0) {
      currentValue = 0;
    } else if (currentValue > 1000) {
      currentValue = 1000;
    }
    this.platform.log.debug(`GET Ozone ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleAirQualityValueGet(deviceData, forIndoor:boolean): CharacteristicValue {
    this.platform.log.debug('Triggered GET AirQualityValue');
  
    let currentValue = this.daikinApi.getAirQualityValue(deviceData, forIndoor);
    // set this to a valid value for CurrentTemperature
    if(currentValue < 0) {
      currentValue = 0;
    } else if (currentValue > 500) {
      currentValue = 500;
    }
    this.platform.log.debug(`GET AirQualityValue ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "PM2.5 Density" characteristic
   */
  handlePM2_5DensityGet(deviceData, forIndoor:boolean): CharacteristicValue {
    this.platform.log.debug('Triggered GET PM2_5Density');
  
    let currentValue = this.daikinApi.getPM2_5Density(deviceData, forIndoor);
    // set this to a valid value for CurrentTemperature
    if(currentValue < 0) {
      currentValue = 0;
    } else if (currentValue > 1000) {
      currentValue = 1000;
    }
    this.platform.log.debug(`GET PM2_5Density ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Current Relative Humidity" characteristic
   */
  handleVocDensityGet(deviceData, forIndoor:boolean): CharacteristicValue {
    this.platform.log.debug('Triggered GET Voc Density');
  
    let currentValue = this.daikinApi.getVocDensity(deviceData, forIndoor);
    // set this to a valid value for CurrentTemperature
    if(currentValue < 0) {
      currentValue = 0;
    } else if (currentValue > 1000) {
      currentValue = 1000;
    }
    this.platform.log.debug(`GET Voc Density ${currentValue}`);
    return currentValue;
  }
}
