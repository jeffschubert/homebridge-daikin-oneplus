import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logging } from 'homebridge';
import { HistoryConsumer, ThermostatReading } from './types.js';

export interface JsonlFileHistoryConsumerOptions {
  storagePath: string; // e.g. api.user.storagePath()
  retentionDays?: number; // default 7
}

/**
 * Reference HistoryConsumer implementation. Writes readings to local,
 * append-only, per-day JSONL files under <storagePath>/daikin-oneplus-history/.
 *
 * Use this as a template for your own consumer (MQTT, InfluxDB, a database,
 * a webhook, etc.) — the only required contract is onReading(); destroy()
 * is optional and only needed if your consumer holds timers/connections
 * that need cleanup on shutdown.
 */
export class JsonlFileHistoryConsumer implements HistoryConsumer {
  private readonly historyDir: string;
  private retentionDays: number;
  private buffer: Map<string, ThermostatReading[]> = new Map();
  private flushTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;

  public constructor(
    private readonly log: Logging,
    options: JsonlFileHistoryConsumerOptions,
  ) {
    this.historyDir = path.join(options.storagePath, 'daikin-oneplus-history');
    this.retentionDays = options.retentionDays ?? 7;

    this.log.info(
      'JsonlFileHistoryConsumer initialized with retentionDays=%d, storagePath=%s',
      this.retentionDays, this.historyDir,
    );

    const flushIntervalMs = 60_000;
    this.flushTimer = setInterval(() => void this.flush(), flushIntervalMs);
    this.pruneTimer = setInterval(() => void this.pruneOldEntries(), 24 * 60 * 60 * 1000);
  }

  public onReading(reading: ThermostatReading): void {
    if (this.retentionDays <= 0) {
      return; // disabled — e.g. after a persistent write failure
    }
    const dayKey = this.dayKeyFor(reading.timestamp);
    const bucket = this.buffer.get(dayKey) ?? [];
    bucket.push(reading);
    this.buffer.set(dayKey, bucket);
  }

  /** e.g. 1722643200000 -> "2024-08-02" (UTC) */
  private dayKeyFor(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  private filePathForDay(dayKey: string): string {
    return path.join(this.historyDir, `history-${dayKey}.jsonl`);
  }

  private async flush(): Promise<void> {
    if (this.buffer.size === 0) {
      return;
    }
    this.log.debug('Flushing history entries for %d day(s) to disk', this.buffer.size);

    try {
      await fs.mkdir(this.historyDir, { recursive: true });
    } catch (err) {
      this.log.error('Failed to create history directory:', err);
      this.log.error('Disabling history file writing. Please check your storagePath configuration and permissions.');
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
        this.log.error('Disabling history file writing. Please check your storagePath configuration and permissions.');
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
      return [];
    }

    const sinceKey = this.dayKeyFor(since);
    const untilKey = this.dayKeyFor(until);

    const relevantFiles = dayFiles
      .filter((f) => f.startsWith('history-') && f.endsWith('.jsonl'))
      .filter((f) => {
        const dayKey = f.slice('history-'.length, -'.jsonl'.length);
        return dayKey >= sinceKey && dayKey <= untilKey;
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

  public async query(deviceId: string, since: number, until: number = Date.now()): Promise<ThermostatReading[]> {
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
      return;
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

  public async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
    }
    await this.flush(); // don't lose the last buffered minute
  }
}