import type { Logging } from 'homebridge';
import { EquipmentStatus, HistoryConsumer, DaikinOptions, ThermostatData, ThermostatMode, ThermostatReading } from './types.js';
import { JsonlFileHistoryConsumer } from './jsonlFileHistoryConsumer.js';

/**
 * Captures readings independent of any single consumer (files, Eve, MQTT...).
 * Normalizes raw Daikin API data into a ThermostatReading and hands it to
 * every registered consumer. Storage/export concerns live entirely in
 * consumers — HistoryStore itself has no opinion on where data ends up.
 */
export class HistoryStore {
  private readonly recordRawData: boolean;
  private readonly rawDataFieldList: string[] | null; // null = record everything present
  private readonly warnedMissingFields = new Set<string>();
  private consumers: HistoryConsumer[] = [];

  public constructor(
    private readonly log: Logging,
    private readonly options: DaikinOptions,
  ) {
    this.recordRawData = options.recordRawData ?? false;
    const rawDataFields = options.rawDataFields ?? '';
    const requested = rawDataFields
      .split(',')
      .map(f => f.trim())
      .filter(Boolean);
    this.rawDataFieldList = requested.length > 0 ? requested : null;

    this.initConsumers();
  }

  private initConsumers() {
    if (this.options.enableHistory) {
      this.registerConsumer(
        new JsonlFileHistoryConsumer(this.log, {
          storagePath: this.options.storagePath,
          retentionDays: (this.options.retentionDays as number) ?? 7,
        }),
      );
    }
    // Future consumers (MQTT, InfluxDB, etc.) can be registered here.
  }

  public registerConsumer(consumer: HistoryConsumer): void {
    this.consumers.push(consumer);
  }

  public async record(deviceId: string, data: ThermostatData, setPoint: number): Promise<void> {
    if (this.consumers.length === 0) {
      return; // nothing registered to receive this reading
    }

    const reading: ThermostatReading = this.getThermostatReading(deviceId, data, setPoint);

    for (const consumer of this.consumers) {
      try {
        await consumer.onReading(reading);
      } catch (err) {
        this.log.warn('History consumer failed to process reading:', err);
      }
    }
  }

  private getThermostatReading(deviceId: string, data: ThermostatData, setPoint: number): ThermostatReading {
    return {
      timestamp: Date.now(),
      deviceId: deviceId,
      indoorTemperature: data.tempIndoor,
      outdoorTemperature: data.tempOutdoor,
      indoorHumidity: data.humIndoor,
      outdoorHumidity: data.humOutdoor,
      setpoint: setPoint,
      mode: (data.mode ?? ThermostatMode.OFF).toString(),
      modeName: ThermostatMode[data.mode ?? ThermostatMode.OFF],
      state: (data.equipmentStatus ?? EquipmentStatus.IDLE).toString(),
      stateName: EquipmentStatus[data.equipmentStatus ?? EquipmentStatus.IDLE],
      allData: this.recordRawData ? this.filterRawData(data) : undefined,
    };
  }

  private filterRawData(data: ThermostatData): Record<string, unknown> {
    const rawData = data as unknown as Record<string, unknown>;

    if (!this.rawDataFieldList) {
      return this.sortedCopy(rawData);
    }

    const filtered: Record<string, unknown> = {};
    const missingFields: string[] = [];

    for (const field of this.rawDataFieldList) {
      if (field in rawData) {
        filtered[field] = rawData[field];
      } else if (!this.warnedMissingFields.has(field)) {
        missingFields.push(field);
        this.warnedMissingFields.add(field);
      }
    }

    if (missingFields.length > 0) {
      this.log.warn(
        'rawDataFields: the following field(s) were not found in this reading: %s. This may be normal if your ' +
          "thermostat model doesn't report these fields, or they only appear under certain conditions.",
        missingFields.join(', '),
      );
    }

    return this.sortedCopy(filtered);
  }

  private sortedCopy(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = obj[key];
    }
    return sorted;
  }

  public async destroy(): Promise<void> {
    for (const consumer of this.consumers) {
      try {
        await consumer.destroy?.();
      } catch (err) {
        this.log.warn('History consumer failed to clean up:', err);
      }
    }
  }
}
