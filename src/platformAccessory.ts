import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusAccessory {
  private service: Service;

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
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
                    || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async handleCurrentHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET CurrentHeatingCoolingState');
    const currentStatus = await this.daikinApi.getCurrentStatus(this.deviceId);
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
    return currentValue;
  }
  
  
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET TargetHeatingCoolingState');
    //“mode”: 2 is cool, 3 is auto, 1 is heat, 0 is off, emergency heat is 4
  
    // set this to a valid value for TargetHeatingCoolingState
    let currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const currentStatus = await this.daikinApi.getTargetState(this.deviceId);
    // set this to a valid value for CurrentHeatingCoolingState
    switch(currentStatus){
      case 1:
      case 4:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        break;
      case 2:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
        break;
      case 3:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
        break;
    }
  
    return currentValue;
  }
  
  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TargetHeatingCoolingState:', value);
    
    //“mode”: 2 is cool, 3 is auto, 1 is heat, 0 is off, emergency heat is 4
  
    // set this to a valid value for TargetHeatingCoolingState
    let requestedState = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
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
    }
  
    this.daikinApi.setTargetState(this.deviceId, requestedState);
  }
  
  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET CurrentTemperature');
  
    let currentTemp = await this.daikinApi.getCurrentTemp(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(currentTemp < -270) {
      currentTemp = -270;
    } else if (currentTemp > 100) {
      currentTemp = 100;
    }
    return currentTemp;
  }
  
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  async handleTargetTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET TargetTemperature');
  
    //TODO: Need to get whether cooling or heating to request correct target temp
    let currentTemp = await this.daikinApi.getTargetTemp(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(currentTemp < -270) {
      currentTemp = -270;
    } else if (currentTemp > 100) {
      currentTemp = 100;
    }
    return currentTemp;
  }
  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TargetTemperature:', value);
  }
  
  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Triggered GET TemperatureDisplayUnits');
  
    // set this to a valid value for TemperatureDisplayUnits
    const currentValue = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  
    return currentValue;
  }
  
  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Triggered SET TemperatureDisplayUnits:', value);
  }
}
