import { Service, PlatformAccessory, CharacteristicValue} from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DaikinOnePlusThermostat {
  private service: Service;

  //Thermostat characteristics
  CurrentTemperature!: CharacteristicValue;
  TargetTemperature!: CharacteristicValue;
  CurrentHeatingCoolingState!: CharacteristicValue;
  CurrentRelativeHumidity!: CharacteristicValue;
  TargetHeatingCoolingState!: CharacteristicValue;
  TargetRelativeHumidity!: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;

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
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(()=>{
        return this.TargetHeatingCoolingState!;
      })
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(()=>{
        return this.TargetTemperature!;
      })
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(()=>{
        return this.TemperatureDisplayUnits!;
      })
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetRelativeHumidity)
      .onGet(()=>{
        return this.TargetRelativeHumidity!;
      })
      .onSet(this.handleTargetHumiditySet.bind(this));
    this.updateValues();
  }

  updateValues() {
    // push the new value to HomeKit
    if(this.daikinApi.deviceHasData(this.deviceId)){
      this.TargetTemperature = this.handleTargetTemperatureGet();
      this.CurrentTemperature = this.handleCurrentTemperatureGet();
      this.TargetHeatingCoolingState = this.handleTargetHeatingCoolingStateGet();
      this.TemperatureDisplayUnits = this.handleTemperatureDisplayUnitsGet();
      this.TargetRelativeHumidity = this.handleTargetHumidityGet();
      this.CurrentHeatingCoolingState = this.handleCurrentHeatingCoolingStateGet();
      this.CurrentRelativeHumidity = this.handleCurrentHumidityGet();

      if (this.TargetTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.TargetTemperature);
      }
      if (this.CurrentTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.CurrentTemperature);
      }
      if(this.TargetHeatingCoolingState !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.TargetHeatingCoolingState);
      }
      if(this.TemperatureDisplayUnits !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
      }
      if(this.TargetRelativeHumidity !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TargetRelativeHumidity, this.TargetRelativeHumidity);
      }
      if(this.CurrentHeatingCoolingState !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);
      }
      if(this.CurrentRelativeHumidity !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      }
      this.platform.log.debug('Thermostat', this.accessory.displayName, '- Updated thermostat characteristics...');
    } else{
      this.platform.log.info('Thermostat', this.accessory.displayName, '- Waiting for data...');
    }
    setTimeout(()=>this.updateValues(), 2000);
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  handleCurrentHeatingCoolingStateGet(): CharacteristicValue {
    //"equipmentStatus": the running state of the system, 1=cooling, 2=overcool dehumidifying, 3=heating, 4=fan, 5=idle, 
    // set this to a valid value for CurrentHeatingCoolingState
    let currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    const currentStatus = this.daikinApi.getCurrentStatus(this.deviceId);
    switch(currentStatus){
      case 1:
        currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
        break;
      case 3:
        currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        break;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get CurrentHeatingCoolingState:', currentValue);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet(): CharacteristicValue {
    //“mode”: 2 is cool, 3 is auto, 1 is heat, 0 is off, emergency heat is 4
    // set this to a valid value for TargetHeatingCoolingState
    let currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const currentStatus = this.daikinApi.getTargetState(this.deviceId);
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
        this.platform.log.debug('Thermostat', this.accessory.displayName, 
          '- Unable to get TargetHeatingCoolingState. Unknown state retrieved:', currentStatus);
        break;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get TargetHeatingCoolingState:', currentValue);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet(): CharacteristicValue {
    let currentTemp = this.daikinApi.getCurrentTemp(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(currentTemp < -270) {
      currentTemp = -270;
    } else if (currentTemp > 100) {
      currentTemp = 100;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get CurrentTemperature:', currentTemp);
    return currentTemp;
  }
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet(): CharacteristicValue {
    let targetTemp = this.daikinApi.getTargetTemp(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(targetTemp < -270) {
      targetTemp = -270;
    } else if (targetTemp > 100) {
      targetTemp = 100;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get TargetTemperature:', targetTemp);
    return targetTemp;
  }
  
  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet(): CharacteristicValue {
    let targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    const displayUnits = this.daikinApi.getDisplayUnits(this.deviceId);
    // set this to a valid value for TemperatureDisplayUnits
    if(displayUnits === 0) {
      targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    } else {
      targetUnits = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get TemperatureDisplayUnits:', targetUnits);
    return targetUnits;
  }
  
  /**
   * Handle requests to get the current value of the "Current Relative Humidity" characteristic
   */
  handleCurrentHumidityGet(): CharacteristicValue {
    let currentHumidity = this.daikinApi.getCurrentHumidity(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(currentHumidity < 0) {
      currentHumidity = 0;
    } else if (currentHumidity > 100) {
      currentHumidity = 100;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get CurrentRelativeHumidity:', currentHumidity);
    return currentHumidity;
  }
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetHumidityGet(): CharacteristicValue {
    let targetHumidity = this.daikinApi.getTargetHumidity(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(targetHumidity < 0) {
      targetHumidity = 0;
    } else if (targetHumidity > 100) {
      targetHumidity = 100;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get TargetHumidity:', targetHumidity);
    return targetHumidity;
  }
  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set TargetTemperature:', value);
    this.TargetTemperature = value;
    await this.daikinApi.setTargetTemp(this.deviceId, Number(value));
  }
  
  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set TargetHeatingCoolingState:', value);
    this.TargetHeatingCoolingState = value;

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
  
    await this.daikinApi.setTargetState(this.deviceId, requestedState);
  }
  
  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set TemperatureDisplayUnits:', value);
    this.TemperatureDisplayUnits = value;
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
    await this.daikinApi.setDisplayUnits(this.deviceId, requestedUnits);
  }

  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetHumiditySet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set TargetHumidity:', value);
    this.TargetRelativeHumidity = value;
    await this.daikinApi.setTargetHumidity(this.deviceId, Number(value));
  }
}
