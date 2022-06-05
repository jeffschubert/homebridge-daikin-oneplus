import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi';

import { DaikinOnePlusPlatform } from './platform';

/**
 * Circulate Air Fan
 * Fan can either be on or off
 * Speed can be set to low, med, or high
 */
export class DaikinOnePlusCirculateAirFan {
  private service: Service;
  CurrentState!: CharacteristicValue;

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
    this.service = this.accessory.getService(this.platform.Service.Fanv2)
                    || this.accessory.addService(this.platform.Service.Fanv2);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        this.daikinApi.updateNow();
        return this.handleActiveGet();
      })
      .onSet(this.handleActiveSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({minValue:0, maxValue: 3, minStep:1})
      .onGet(()=>{
        this.daikinApi.updateNow();
        return this.handleSpeedGet();
      })
      .onSet(this.handleSpeedSet.bind(this));

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    const value = this.handleActiveGet();
    this.service.updateCharacteristic(this.platform.Characteristic.Active, value);
    const speed = this.handleSpeedGet();
    this.service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, speed);
  }

  /**
   * Handle requests to get the current value of the "Active" characteristic
   */
  handleActiveGet() {
    const currentState =( this.daikinApi.deviceHasData(this.deviceId) &&
      this.daikinApi.getCirculateAirFanActive(this.deviceId)
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE);
    this.platform.log.debug(this.accessory.displayName, '- Get Circulate Air Fan State:', currentState);
    return currentState;
  }

  /**
   * Handle requests to set the "Active" characteristic
   */
  async handleActiveSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, '- Set Circulate Air Fan State:', value);
    await this.daikinApi.setCirculateAirFanActive(this.deviceId, value === this.platform.Characteristic.Active.ACTIVE);
  }

  /**
   * Handle requests to get the current value of the "Rotation Speed" characteristic
   */
  handleSpeedGet() {
    let currentSpeed = 0;
    if(this.daikinApi.deviceHasData(this.deviceId)){
      const currentState = this.daikinApi.getCirculateAirFanActive(this.deviceId);
      const rawSpeed = this.daikinApi.getCirculateAirFanSpeed(this.deviceId);
      if(currentState){
        switch (rawSpeed) {
          case 1: //med
            currentSpeed = 2;
            break;
          case 2: //high
            currentSpeed = 3;
            break;
          default: //low
            currentSpeed = 1;
            break;
        }
      } else {
        currentSpeed = 0;
      }
    }
    this.platform.log.debug(this.accessory.displayName, '- Get Circulate Air Fan Speed:', currentSpeed);
    return currentSpeed;
  }

  /**
   * Handle requests to set the "Rotation Speed" characteristic
   */
  async handleSpeedSet(value: CharacteristicValue) {
    this.platform.log.debug(this.accessory.displayName, '- Set Circulate Air Fan Speed:', value);
    const newSpeed = Number(value) - 1;
    await this.daikinApi.setCirculateAirFanSpeed(this.deviceId, newSpeed);
  }
}