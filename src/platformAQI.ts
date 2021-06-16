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
    this.updateValues();
  }

  updateValues() {
    // push the new value to HomeKit
    if(this.daikinApi.deviceHasData(this.deviceId)){
      this.service.updateCharacteristic(this.platform.Characteristic.AirQuality, this.handleAirQualityGet());
      if(!this.forIndoor){
        this.service.updateCharacteristic(this.platform.Characteristic.OzoneDensity, this.handleOzoneGet());
      }
      const aqValue = this.handleAirQualityValueGet();
      this.service.setCharacteristic(this.platform.Characteristic.Name, `${this.displayName} ${aqValue}`);

      this.service.updateCharacteristic(this.platform.Characteristic.PM2_5Density, this.handlePM2_5DensityGet());

      if(this.forIndoor){
        this.service.updateCharacteristic(this.platform.Characteristic.VOCDensity, this.handleVocDensityGet());
      }
      this.platform.log.debug('Updated AQI characteristics...');
    } else{
      this.platform.log.info(`${this.accessory.displayName} waiting for data.`);
    }
      
    setTimeout(()=>this.updateValues(), 2000);
  }

  /**
   * Handle requests to get the current value of the "Air Quality" characteristic
   */
  handleAirQualityGet(): CharacteristicValue {
    const currentAqLevel = this.daikinApi.getAirQualityLevel(this.deviceId, this.forIndoor);

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
  handleOzoneGet(): CharacteristicValue {
    let currentValue = this.daikinApi.getOzone(this.deviceId, this.forIndoor);
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
  handleAirQualityValueGet(): CharacteristicValue {
    let currentValue = this.daikinApi.getAirQualityValue(this.deviceId, this.forIndoor);
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
  handlePM2_5DensityGet(): CharacteristicValue {
    let currentValue = this.daikinApi.getPM2_5Density(this.deviceId, this.forIndoor);
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
  handleVocDensityGet(): CharacteristicValue {
    let currentValue = this.daikinApi.getVocDensity(this.deviceId, this.forIndoor);
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
