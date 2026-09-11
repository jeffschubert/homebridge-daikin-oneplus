import type { API, Logging, PlatformAccessory } from 'homebridge';
import fakegato from 'fakegato-history';
import { AccessoryContext, EquipmentStatus, HistoryConsumer, ThermostatReading } from './types.js';

/**
 * Feeds readings into the Eve app's history graphs via fakegato-history.
 * This is the only file in the plugin that references fakegato-history —
 * everything else talks to it through the generic HistoryConsumer contract
 * (onReading, onAccessoryRegistered) so the platform/accessory code has no
 * idea Eve is involved.
 *
 * fakegato needs a PlatformAccessory to attach its service to, which
 * HistoryConsumer.onReading() doesn't provide — that's what
 * onAccessoryRegistered() is for. It's called once a device's accessory
 * exists; we stash a logging service per deviceId and feed it from
 * onReading() from then on. Readings that arrive before the accessory is
 * registered (or for a device this consumer never saw registered, e.g.
 * ignoreThermostat) are silently dropped.
 */
export class FakeGatoHistoryConsumer implements HistoryConsumer {
  private readonly FakeGatoHistoryService: ReturnType<typeof fakegato>;
  private readonly loggingServices = new Map<string, InstanceType<ReturnType<typeof fakegato>>>();

  public constructor(
    private readonly log: Logging,
    api: API,
  ) {
    this.FakeGatoHistoryService = fakegato(api);
  }

  public onAccessoryRegistered(deviceId: string, accessory: PlatformAccessory<AccessoryContext>): void {
    if (this.loggingServices.has(deviceId)) {
      return; // already attached — onAccessoryRegistered can fire again on rediscovery/cache restore
    }
    const loggingService = new this.FakeGatoHistoryService('thermo', accessory, {
      log: this.log,
      storage: 'fs',
    });
    this.loggingServices.set(deviceId, loggingService);
  }

  public onReading(reading: ThermostatReading): void {
    const loggingService = this.loggingServices.get(reading.deviceId);
    if (!loggingService) {
      return; // no accessory registered for this device yet
    }

    const isRunning =
      reading.state === EquipmentStatus.HEATING.toString() ||
      reading.state === EquipmentStatus.COOLING.toString() ||
      reading.state === EquipmentStatus.OVERCOOL_DEHUMIDIFYING.toString();

    loggingService.addEntry({
      time: Math.round(reading.timestamp / 1000),
      currentTemp: reading.indoorTemperature,
      setTemp: reading.setpoint,
      valvePosition: isRunning ? 100 : 0,
    });
  }
}
