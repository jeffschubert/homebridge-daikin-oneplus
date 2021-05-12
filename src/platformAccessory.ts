import { Service, PlatformAccessory, CharacteristicValue, CharacteristicEventTypes } from 'homebridge';
import { maxHeaderSize } from 'http';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusAccessory {
  private service: Service;
  private deviceData;

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
    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
                    || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.SET, this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on(CharacteristicEventTypes.SET, this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.SET, this.handleTemperatureDisplayUnitsSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetRelativeHumidity)
      .on(CharacteristicEventTypes.SET, this.handleTargetHumiditySet.bind(this));
      
    setInterval(async () => {
      this.deviceData = await this.daikinApi.getDeviceData(this.deviceId);

      // push the new value to HomeKit
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, 
        this.handleCurrentHeatingCoolingStateGet(this.deviceData));
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, 
        this.handleTargetHeatingCoolingStateGet(this.deviceData));

      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, 
        this.handleCurrentTemperatureGet(this.deviceData));
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, 
        this.handleTargetTemperatureGet(this.deviceData));
      this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, 
        this.handleTemperatureDisplayUnitsGet());
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, 
        this.handleCurrentHumidityGet(this.deviceData));
      this.service.updateCharacteristic(this.platform.Characteristic.TargetRelativeHumidity, 
        this.handleTargetHumidityGet(this.deviceData));

      this.platform.log.debug('Updated values...');
    }, 10000);
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  handleCurrentHeatingCoolingStateGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET CurrentHeatingCoolingState');
    const currentStatus = this.daikinApi.getCurrentStatus(deviceData);
    //"equipmentStatus": the running state of the system, 1=cooling, 2=overcool dehumidifying, 3=heating, 4=fan, 5=idle, 
    // set this to a valid value for CurrentHeatingCoolingState
    let currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    switch(currentStatus){
      case 1:
        currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
        break;
      case 3:
        currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        break;
    }
    this.platform.log.debug(`GET CurrentHeatingCoolingState ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');
    //“mode”: 2 is cool, 3 is auto, 1 is heat, 0 is off, emergency heat is 4
  
    // set this to a valid value for TargetHeatingCoolingState
    let currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const currentStatus = this.daikinApi.getTargetState(deviceData);
    // set this to a valid value for CurrentHeatingCoolingState
    switch(currentStatus){
      case 1:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        break;
      case 2:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
        break;
      case 3:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
        break;
      case 0:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        break;
      default:
        this.platform.log.debug(`Unable to get TargetHeatingCoolingState. Unknown state retrieved: ${currentStatus}`);
        break;
    }
    this.platform.log.debug(`GET TargetHeatingCoolingState ${currentValue}`);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET CurrentTemperature');
  
    let currentTemp = this.daikinApi.getCurrentTemp(deviceData);
    // set this to a valid value for CurrentTemperature
    if(currentTemp < -270) {
      currentTemp = -270;
    } else if (currentTemp > 100) {
      currentTemp = 100;
    }
    this.platform.log.debug(`GET CurrentTemperature ${currentTemp}`);
    return currentTemp;
  }
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET TargetTemperature');
  
    let targetTemp = this.daikinApi.getTargetTemp(deviceData);
    // set this to a valid value for CurrentTemperature
    if(targetTemp < -270) {
      targetTemp = -270;
    } else if (targetTemp > 100) {
      targetTemp = 100;
    }
    this.platform.log.debug(`GET TargetTemperature ${targetTemp}`);
    return targetTemp;
  }
  
  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet(): CharacteristicValue {
    this.platform.log.debug('Triggered GET TemperatureDisplayUnits');
  
    let targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    const displayUnits = this.daikinApi.getDisplayUnits(this.deviceData);
    // set this to a valid value for TemperatureDisplayUnits
    if(displayUnits === 0) {
      targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    } else {
      targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
    this.platform.log.debug(`GET TemperatureDisplayUnits ${targetUnits}`);
    return targetUnits;
  }
  
  /**
   * Handle requests to get the current value of the "Current Relative Humidity" characteristic
   */
  handleCurrentHumidityGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET CurrentRelativeHumidity');
  
    let currentHumidity = this.daikinApi.getCurrentHumidity(deviceData);
    // set this to a valid value for CurrentTemperature
    if(currentHumidity < 0) {
      currentHumidity = 0;
    } else if (currentHumidity > 100) {
      currentHumidity = 100;
    }
    this.platform.log.debug(`GET CurrentRelativeHumidity ${currentHumidity}`);
    return currentHumidity;
  }
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetHumidityGet(deviceData): CharacteristicValue {
    this.platform.log.debug('Triggered GET TargetHumidity');
  
    let targetHumidity = this.daikinApi.getTargetHumidity(deviceData);
    // set this to a valid value for CurrentTemperature
    if(targetHumidity < 0) {
      targetHumidity = 0;
    } else if (targetHumidity > 100) {
      targetHumidity = 100;
    }
    this.platform.log.debug(`GET TargetHumidity ${targetHumidity}`);
    return targetHumidity;
  }
  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TargetTemperature:', value);
    if ( await this.daikinApi.setTargetTemp(this.deviceId, this.deviceData, Number(value))){
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, value);
    }
  }
  
  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TargetHeatingCoolingState:', value);

    //“mode”: 2 is cool, 3 is auto, 1 is heat, 0 is off, emergency heat is 4
  
    // set this to a valid value for TargetHeatingCoolingState
    let requestedState = 0; //OFF
    // set this to a valid value for CurrentHeatingCoolingState
    switch(value){
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        requestedState = 1;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        requestedState = 2;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
        requestedState = 3;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
        requestedState = 0;
        break;
    }
  
    if (await this.daikinApi.setTargetState(this.deviceId, this.deviceData, requestedState)) {
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, value);
    }
  }
  
  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TemperatureDisplayUnits:', value);
    let requestedUnits = 0; //FAHRENHEIT
    switch(value){
      case this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT:
        requestedUnits = 0;
        break;
      case this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS:
        requestedUnits = 1;
        break;
      default:
        requestedUnits = 0;

    }
    if(await this.daikinApi.setDisplayUnits(this.deviceId, requestedUnits)){
      this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, value);
    }
  }

  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetHumiditySet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TargetHumidity:', value);
    if(await this.daikinApi.setTargetHumidity(this.deviceId, Number(value))){
      this.service.updateCharacteristic(this.platform.Characteristic.TargetRelativeHumidity, value);
    }
  }
}
