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
  CurrentHeatingCoolingState!: CharacteristicValue;
  TargetHeatingCoolingState!: CharacteristicValue;
  CurrentTemperature!: CharacteristicValue;
  TargetTemperature!: CharacteristicValue;
  CoolingThresholdTemperature!: CharacteristicValue;
  HeatingThresholdTemperature!: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;
  CurrentRelativeHumidity!: CharacteristicValue;
  TargetRelativeHumidity!: CharacteristicValue;

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
    
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(()=>{
        return this.CurrentHeatingCoolingState!;
      });
      
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(()=>{
        return this.TargetHeatingCoolingState!;
      })
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(()=>{
        return this.CurrentTemperature!;
      });
      
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(()=>{
        return this.TargetTemperature!;
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .setProps({
        minStep: 0.5,
      });

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(()=>{
        return this.CoolingThresholdTemperature!;
      })
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this))
      .setProps({
        minValue: 12,
        maxValue: 32,
        minStep: 0.5,
      });

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(()=>{
        return this.HeatingThresholdTemperature!;
      })
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this))
      .setProps({
        minValue: 10,
        maxValue: 30,
        minStep: 0.5,
      });

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(()=>{
        return this.TemperatureDisplayUnits!;
      })
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(()=>{
        return this.CurrentRelativeHumidity!;
      });
      
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
      this.CurrentHeatingCoolingState = this.handleCurrentHeatingCoolingStateGet();
      this.TargetHeatingCoolingState = this.handleTargetHeatingCoolingStateGet();
      this.CurrentTemperature = this.handleCurrentTemperatureGet();
      this.TargetTemperature = this.handleTargetTemperatureGet();
      this.HeatingThresholdTemperature = this.handleHeatingThresholdTemperatureGet();
      this.CoolingThresholdTemperature = this.handleCoolingThresholdTemperatureGet();
      this.TemperatureDisplayUnits = this.handleTemperatureDisplayUnitsGet();
      this.CurrentRelativeHumidity = this.handleCurrentHumidityGet();
      this.TargetRelativeHumidity = this.handleTargetHumidityGet();

      if(this.CurrentHeatingCoolingState !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, this.CurrentHeatingCoolingState);
      }
      if(this.TargetHeatingCoolingState !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, this.TargetHeatingCoolingState);
      }
      if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .setProps({
            minValue: 10,
            maxValue: 30,
          });
      }
      if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .setProps({
            minValue: 12,
            maxValue: 32,
          });
      }
      if (this.CurrentTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.CurrentTemperature);
      }
      if (this.TargetTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.TargetTemperature);
      }
      if (
        this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO &&
        this.CoolingThresholdTemperature !== undefined
      ) {
        this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.CoolingThresholdTemperature);
      }
      if (
        this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO &&
        this.HeatingThresholdTemperature !== undefined
      ) {
        this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.HeatingThresholdTemperature);
      }
      if(this.TemperatureDisplayUnits !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.TemperatureDisplayUnits);
      }
      if(this.CurrentRelativeHumidity !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, this.CurrentRelativeHumidity);
      }
      if(this.TargetRelativeHumidity !== undefined){
        this.service.updateCharacteristic(this.platform.Characteristic.TargetRelativeHumidity, this.TargetRelativeHumidity);
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

  handleHeatingThresholdTemperatureGet(): CharacteristicValue {
    let temp = this.daikinApi.heatingThresholdTemperature(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(temp < 0) {
      temp = 0;
    } else if (temp > 25) {
      temp = 25;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get HeatingThresholdTemperature:', temp);
    return temp;
  }

  handleCoolingThresholdTemperatureGet(): CharacteristicValue {
    let temp = this.daikinApi.coolingThresholdTemperature(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(temp < 10) {
      temp = 10;
    } else if (temp > 35) {
      temp = 35;
    }
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Get CoolingThresholdTemperature:', temp);
    return temp;
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
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set TargetTemperature:', value);
    this.TargetTemperature = value;
    await this.daikinApi.setTargetTemps(this.deviceId, Number(value));
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set CoolingThresholdTemperature:', value);
    this.CoolingThresholdTemperature = value;
    await this.daikinApi.setTargetTemps(this.deviceId, undefined, undefined, Number(value));
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat', this.accessory.displayName, '- Set HeatingThresholdTemperature:', value);
    this.HeatingThresholdTemperature = value;
    await this.daikinApi.setTargetTemps(this.deviceId, undefined, Number(value), undefined);
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
