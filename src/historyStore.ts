import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logging } from 'homebridge';
import { EquipmentStatus, HistoryConsumer, HistoryStoreOptions, ThermostatData, ThermostatMode, ThermostatReading } from './types.js';

/**
 * Captures readings independent of any single consumer (Eve, MQTT, CSV...).
 * Consumers register themselves and get notified on each new reading;
 * the store also persists to a local append-only JSONL file so history
 * survives restarts and can be queried/exported later.
 */
export class HistoryStore {
  private readonly enableHistory: boolean;
  private readonly historyDir: string;
  private retentionDays: number;
  private readonly recordRawData: boolean;
  private readonly rawDataFields: string;
  private consumers: HistoryConsumer[] = [];
  private buffer: Map<string, ThermostatReading[]> = new Map();
  private flushTimer?: NodeJS.Timeout;
  private readonly rawDataFieldList: string[] | null; // null = record everything present
  private readonly warnedMissingFields = new Set<string>();


  public constructor(
    private readonly log: Logging,
    options: HistoryStoreOptions,
  ) {
    this.enableHistory = options.enableHistory ?? false;
    this.historyDir = path.join(options.storagePath, 'daikin-oneplus-history');
    this.retentionDays = options.retentionDays ?? 7;
    this.recordRawData = options.recordRawData ?? false;
    this.rawDataFields = options.rawDataFields ?? "";
    const requested = this.rawDataFields.split(',').map((f) => f.trim()).filter(Boolean);
    this.rawDataFieldList = requested.length > 0 ? requested : null;

    if(!this.enableHistory){
      this.log.info('HistoryStore is disabled. No readings will be persisted.');
      return;
    }
    log.info('HistoryStore initialized with retentionDays=%d, storagePath=%s', this.retentionDays, this.historyDir);

    const flushIntervalMs = 60_000;
    this.flushTimer = setInterval(() => void this.flush(), flushIntervalMs);
  }

  public registerConsumer(consumer: HistoryConsumer): void {
    this.consumers.push(consumer);
  }

  public async record(deviceId: string, data: ThermostatData, setPoint: number): Promise<void> {
    if(!this.enableHistory){
      return;
    }

    const reading: ThermostatReading = this.getThermostatReading(deviceId, data, setPoint);
    
    if(this.retentionDays > 0){
      const dayKey = this.dayKeyFor(reading.timestamp);
      const bucket = this.buffer.get(dayKey) ?? [];
      bucket.push(reading);
      this.buffer.set(dayKey, bucket);
    }

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
      modeName: ThermostatMode[(data.mode ?? ThermostatMode.OFF)],
      state: (data.equipmentStatus ?? EquipmentStatus.IDLE).toString(),
      stateName: EquipmentStatus[(data.equipmentStatus ?? EquipmentStatus.IDLE)],
      allData: this.recordRawData ? this.filterRawData(data) : undefined,
    };
  }

  private filterRawData(data: ThermostatData): Record<string, unknown> {
    const rawData = data as unknown as Record<string, unknown>; // ThermostatData is a partial view; the real object may have more fields at runtime

    if (!this.rawDataFieldList) {
      return this.sortedCopy(rawData); // no filter configured — record everything present
    }

    const filtered: Record<string, unknown> = {};
    const missingFields: string[] = [];

    for (const field of this.rawDataFieldList) {
      if (field in rawData) {
        filtered[field] = rawData[field];
      } else if (!this.warnedMissingFields.has(field)) {
        missingFields.push(field);
        this.warnedMissingFields.add(field); // log once per field name, not every poll cycle
      }
    }
    
    if(missingFields.length > 0){
      this.log.warn(
        'rawDataFields: the following field(s) were not found in this reading: %s. This may be normal if your ' +
        'thermostat model doesn\'t report these fields, or they only appear under certain conditions.',
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
  
  /** e.g. 1722643200000 -> "2024-08-02" (UTC) */
  private dayKeyFor(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  private filePathForDay(dayKey: string): string {
    return path.join(this.historyDir, `history-${dayKey}.jsonl`);
  }

  private async flush(): Promise<void> {
    this.log.debug('Flushing %d history entries to disk', this.buffer.size);
    if (this.buffer.size === 0) {
      return;
    }

    try{
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch(err){
      this.log.error('Failed to create history directory:', err);
      this.log.error('Disabling history logging. Please check your storagePath configuration and permissions.');
      this.retentionDays = 0;
      return;
    }

    const pending = this.buffer;
    this.buffer = new Map();

    for (const [dayKey, readings] of pending) {
      const lines = readings.map((r) => JSON.stringify(r)).join('\n') + '\n';
      try {
        await fs.appendFile(this.filePathForDay(dayKey), lines, 'utf8');
      } catch (err) {
        this.log.error(`Failed to write history file for ${dayKey}:`, err);
        this.log.error('Disabling history logging. Please check your storagePath configuration and permissions.');
        this.retentionDays = 0;
        return;
      }
    }

  }

  /** Reads every day-file whose date falls within [since, until]. */
  private async readRange(since: number, until: number = Date.now()): Promise<ThermostatReading[]> {
    let dayFiles: string[];
    try {
      dayFiles = await fs.readdir(this.historyDir);
    } catch {
      return []; // no history yet
    }

    const sinceKey = this.dayKeyFor(since);
    const untilKey = this.dayKeyFor(until);

    const relevantFiles = dayFiles
      .filter((f) => f.startsWith('history-') && f.endsWith('.jsonl'))
      .filter((f) => {
        const dayKey = f.slice('history-'.length, -'.jsonl'.length);
        return dayKey >= sinceKey && dayKey <= untilKey; // ISO dates sort lexicographically
      });

    const results: ThermostatReading[] = [];
    for (const file of relevantFiles) {
      try {
        const raw = await fs.readFile(path.join(this.historyDir, file), 'utf8');
        for (const line of raw.split('\n')) {
          if (!line) {
            continue;
          }
          const reading = JSON.parse(line) as ThermostatReading;
          if (reading.timestamp >= since && reading.timestamp <= until) {
            results.push(reading);
          }
        }
      } catch (err) {
        this.log.warn(`Failed to read history file ${file}:`, err);
      }
    }
    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async query(deviceId: string, since: number, until: number = Date.now()): Promise<ThermostatReading[]> {
    const all = await this.readRange(since, until);
    return all.filter((r) => r.deviceId === deviceId);
  }

  /** Deletes whole day-files older than retentionDays — no read/rewrite needed. */
  public async pruneOldEntries(): Promise<void> {
    const cutoffKey = this.dayKeyFor(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);

    let dayFiles: string[];
    try {
      dayFiles = await fs.readdir(this.historyDir);
    } catch {
      return; // no history yet
    }

    for (const file of dayFiles) {
      if (!file.startsWith('history-') || !file.endsWith('.jsonl')) {
        continue;
      }
      const dayKey = file.slice('history-'.length, -'.jsonl'.length);
      if (dayKey < cutoffKey) {
        try {
          await fs.unlink(path.join(this.historyDir, file));
        } catch (err) {
          this.log.warn(`Failed to delete old history file ${file}:`, err);
        }
      }
    }
  }

  public destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      void this.flush();
    }
  }
}