import { Service, PlatformAccessory, CharacteristicValue} from 'homebridge';
import { DaikinApi, TargetHeatingCoolingState } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Thermostat
 * Exposes thermostat related characteristics for the Daikin One+ thermostat.
 */
export class DaikinOnePlusThermostat {
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
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Thermostat) 
                    || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleCurrentHeatingCoolingStateGet();
      });
      
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleTargetHeatingCoolingStateGet();
      })
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleCurrentTemperatureGet();
      });
      
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleTargetTemperatureGet();
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .setProps({
        minStep: 0.5,
      });

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleCoolingThresholdTemperatureGet();
      })
      .onSet(this.handleCoolingThresholdTemperatureSet.bind(this))
      .setProps({
        minValue: 12,
        maxValue: 32,
        minStep: 0.1,
      });

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleHeatingThresholdTemperatureGet();
      })
      .onSet(this.handleHeatingThresholdTemperatureSet.bind(this))
      .setProps({
        minValue: 10,
        maxValue: 30,
        minStep: 0.1,
      });

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleTemperatureDisplayUnitsGet();
      })
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleCurrentHumidityGet();
      });
      
    this.service.getCharacteristic(this.platform.Characteristic.TargetRelativeHumidity)
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleTargetHumidityGet();
      })
      .onSet(this.handleTargetHumiditySet.bind(this));

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    // push the new value to HomeKit
    if(this.daikinApi.deviceHasData(this.deviceId)){
      const targetHeatingCoolingState = this.handleTargetHeatingCoolingStateGet();
      const heatingThresholdTemperature = this.handleHeatingThresholdTemperatureGet();
      const coolingThresholdTemperature = this.handleCoolingThresholdTemperatureGet();

      this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, 
        this.handleCurrentHeatingCoolingStateGet());
      this.service.updateCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, 
        targetHeatingCoolingState);

      if (targetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .setProps({
            minValue: 10,
            maxValue: 30,
          });
      }
      if (targetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .setProps({
            minValue: 12,
            maxValue: 32,
          });
      }
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, 
        this.handleCurrentTemperatureGet());
      this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, 
        this.handleTargetTemperatureGet());

      if (targetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO &&
          coolingThresholdTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, coolingThresholdTemperature);
      }
      if (targetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.AUTO &&
          heatingThresholdTemperature !== undefined) {
        this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, heatingThresholdTemperature);
      }

      this.service.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, 
        this.handleTemperatureDisplayUnitsGet());
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, 
        this.handleCurrentHumidityGet());
      this.service.updateCharacteristic(this.platform.Characteristic.TargetRelativeHumidity, 
        this.handleTargetHumidityGet());
    }
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
    this.platform.log.debug('%s - Get CurrentHeatingCoolingState: %d', this.accessory.displayName, currentValue);
    return currentValue;
  }
  
  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet(): CharacteristicValue {
    // set this to a valid value for TargetHeatingCoolingState
    let currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    const currentStatus = this.daikinApi.getTargetState(this.deviceId);
    // set this to a valid value for CurrentHeatingCoolingState
    switch(currentStatus){
      case TargetHeatingCoolingState.HEAT:
      case TargetHeatingCoolingState.AUXILIARY_HEAT:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
        break;
      case TargetHeatingCoolingState.COOL:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;
        break;
      case TargetHeatingCoolingState.AUTO:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
        break;
      case TargetHeatingCoolingState.OFF:
        currentValue = this.platform.Characteristic.TargetHeatingCoolingState.OFF;
        break;
      default:
        this.platform.log.debug('%s - Unable to get TargetHeatingCoolingState. Unknown state retrieved: %s', 
          this.accessory.displayName, currentStatus);
        break;
    }
    this.platform.log.debug('%s - Get TargetHeatingCoolingState: %d', this.accessory.displayName, currentValue);
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
    this.platform.log.debug('%s - Get CurrentTemperature: %f', this.accessory.displayName, currentTemp);
    return currentTemp;
  }
  
  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet(): CharacteristicValue {
    let targetTemp = this.daikinApi.getTargetTemp(this.deviceId);
    // set this to a valid value for CurrentTemperature
    if(targetTemp < 10) {
      targetTemp = 10;
    } else if (targetTemp > 38) {
      targetTemp = 38;
    }
    this.platform.log.debug('%s - Get TargetTemperature: %f', this.accessory.displayName, targetTemp);
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
    this.platform.log.debug('%s - Get HeatingThresholdTemperature: %f', this.accessory.displayName, temp);
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
    this.platform.log.debug('%s - Get CoolingThresholdTemperature: %f', this.accessory.displayName, temp);
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
    this.platform.log.debug('%s - Get TemperatureDisplayUnits: %s', this.accessory.displayName, targetUnits);
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
    this.platform.log.debug('%s - Get CurrentRelativeHumidity: %f', this.accessory.displayName, currentHumidity);
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
    this.platform.log.debug('%s - Get TargetHumidity: %f', this.accessory.displayName, targetHumidity);
    return targetHumidity;
  }
  
  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set TargetHeatingCoolingState: %s', this.accessory.displayName, value);
  
    // set this to a valid value for TargetHeatingCoolingState
    let requestedState = TargetHeatingCoolingState.OFF;
    // set this to a valid value for CurrentHeatingCoolingState
    switch(value){
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        requestedState = TargetHeatingCoolingState.HEAT;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        requestedState = TargetHeatingCoolingState.COOL;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
        requestedState = TargetHeatingCoolingState.AUTO;
        break;
      case this.platform.Characteristic.TargetHeatingCoolingState.OFF:
        requestedState = TargetHeatingCoolingState.OFF;
        break;
    }
  
    await this.daikinApi.setTargetState(this.deviceId, requestedState);
  }
  
  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set TargetTemperature: %s', this.accessory.displayName, value);
    await this.daikinApi.setTargetTemps(this.deviceId, Number(value));
  }

  /**
   * Handle requests to set the "Cooling Threshold Temperature" characteristic
   */
  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set CoolingThresholdTemperature: %s', this.accessory.displayName, value);
    await this.daikinApi.setTargetTemps(this.deviceId, undefined, undefined, Number(value));
  }

  /**
   * Handle requests to set the "Heating Threshold Temperature" characteristic
   */
  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set HeatingThresholdTemperature: %s', this.accessory.displayName, value);
    await this.daikinApi.setTargetTemps(this.deviceId, undefined, Number(value), undefined);
  }
  
  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  async handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set TemperatureDisplayUnits: %s', this.accessory.displayName, value);
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
   * Handle requests to set the "Target Humidity" characteristic
   */
  async handleTargetHumiditySet(value: CharacteristicValue) {
    this.platform.log.debug('%s - Set TargetHumidity: %s', this.accessory.displayName, value);
    await this.daikinApi.setTargetHumidity(this.deviceId, Number(value));
  }
}
