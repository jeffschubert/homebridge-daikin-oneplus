import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DaikinApi } from './daikinapi.js';
import { AccessoryContext } from './types.js';
import { DaikinOnePlusPlatform } from './platform.js';

export class DaikinOnePlusOutdoorTemperature {
  private service: Service;

  public constructor(
    private readonly platform: DaikinOnePlusPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
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

    this.daikinApi.addListener(this.deviceId, this.updateValues.bind(this));
  }

  private updateValues() {
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.handleTemperatureGet());
  }

  private handleTemperatureGet(): CharacteristicValue {
    const characteristic = this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    const currentOutdoorTemp = this.daikinApi.getOutdoorTemp(this.deviceId);
    // Daikin reports 255 when it has no outdoor reading; keep showing the last valid value instead.
    if (currentOutdoorTemp < (characteristic.props.minValue ?? -270) || currentOutdoorTemp > (characteristic.props.maxValue ?? 100)) {
      this.platform.log.debug('%s - Ignoring out-of-range Outdoor Temperature: %d', this.accessory.displayName, currentOutdoorTemp);
      return characteristic.value ?? 0;
    }
    this.platform.log.debug('%s - Get Outdoor Temperature: %d', this.accessory.displayName, currentOutdoorTemp);
    return currentOutdoorTemp;
  }
}
