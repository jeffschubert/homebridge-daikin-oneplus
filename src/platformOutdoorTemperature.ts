import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';

import { DaikinOnePlusPlatform } from './platform.js';

export class DaikinOnePlusOutdoorTemperature {
  private service: Service;

  constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceId: string,
    private readonly daikinApi: DaikinApi,
  ) {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.firmwareVersion);

    this.service =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).onGet(() => {
      this.daikinApi.updateNow();
      return this.handleTemperatureGet();
    });

    this.updateValues();
    this.daikinApi.addListener(this.updateValues.bind(this));
  }

  updateValues() {
    if (this.daikinApi.deviceHasData(this.deviceId)) {
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.handleTemperatureGet());
    }
  }

  handleTemperatureGet(): CharacteristicValue {
    const currentOutdoorTemp = this.daikinApi.getOutdoorTemp(this.deviceId);
    this.platform.log.debug('%s - Get Outdoor Temperature: %d', this.accessory.displayName, currentOutdoorTemp);
    return currentOutdoorTemp;
  }
}
