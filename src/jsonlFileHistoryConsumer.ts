import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Logging } from 'homebridge';
import { HistoryConsumer, ThermostatReading } from './types.js';

export interface JsonlFileHistoryConsumerOptions {
  storagePath: string; // e.g. api.user.storagePath()
  retentionDays?: number; // default 7
  compressHistoryFiles?: boolean; // default true
}

const PLAIN_EXT = '.jsonl';
const GZ_EXT = '.jsonl.gz';

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
  private readonly compressHistoryFiles: boolean;
  private buffer: Map<string, ThermostatReading[]> = new Map();
  private flushTimer?: NodeJS.Timeout;
  private maintenanceTimer?: NodeJS.Timeout;

  public constructor(
    private readonly log: Logging,
    options: JsonlFileHistoryConsumerOptions,
  ) {
    this.historyDir = path.join(options.storagePath, 'daikin-oneplus-history');
    this.retentionDays = options.retentionDays ?? 7;
    this.compressHistoryFiles = options.compressHistoryFiles ?? true;

    this.log.info('JsonlFileHistoryConsumer initialized with retentionDays=%d, storagePath=%s', this.retentionDays, this.historyDir);

    const flushIntervalMs = 60_000;
    this.flushTimer = setInterval(() => void this.flush(), flushIntervalMs);
    this.maintenanceTimer = setInterval(() => void this.runMaintenance(), 60 * 60 * 1000);
    void this.runMaintenance(); // catch up on anything stale from while we were down
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
    return path.join(this.historyDir, `history-${dayKey}${PLAIN_EXT}`);
  }

  private gzFilePathForDay(dayKey: string): string {
    return path.join(this.historyDir, `history-${dayKey}${GZ_EXT}`);
  }

  /** Extracts the day-key from a history filename, in either plain or compressed form. Returns null for anything else found in the directory. */
  private dayKeyFromFilename(file: string): string | null {
    if (!file.startsWith('history-')) {
      return null;
    }
    if (file.endsWith(GZ_EXT)) {
      return file.slice('history-'.length, -GZ_EXT.length);
    }
    if (file.endsWith(PLAIN_EXT)) {
      return file.slice('history-'.length, -PLAIN_EXT.length);
    }
    return null;
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
      const lines = readings.map(r => JSON.stringify(r)).join('\n') + '\n';
      try {
        // Always append to the plain file — today's file is never compressed while still being written.
        await fs.appendFile(this.filePathForDay(dayKey), lines, 'utf8');
      } catch (err) {
        this.log.error(`Failed to write history file for ${dayKey}:`, err);
        this.log.error('Disabling history file writing. Please check your storagePath configuration and permissions.');
        this.retentionDays = 0;
        return;
      }
    }
  }

  /** Runs the periodic upkeep: compress finished days, then prune whatever falls outside retention. */
  private async runMaintenance(): Promise<void> {
    await this.compressCompletedDays();
    await this.pruneOldEntries();
  }

  /**
   * Gzips any plain .jsonl file whose day has ended (i.e. every file except
   * today's), then removes the uncompressed original. Today's file is left
   * alone since it's still being appended to.
   */
  private async compressCompletedDays(): Promise<void> {
    if (!this.compressHistoryFiles) {
      return;
    }
    const todayKey = this.dayKeyFor(Date.now());
    let dayFiles: string[];
    try {
      dayFiles = await fs.readdir(this.historyDir);
    } catch {
      return; // nothing written yet
    }

    for (const file of dayFiles) {
      if (!file.endsWith(PLAIN_EXT)) {
        continue; // already compressed, or not one of ours
      }
      const dayKey = this.dayKeyFromFilename(file);
      if (dayKey === null || dayKey >= todayKey) {
        continue; // still being written today
      }
      await this.compressFile(file, dayKey);
    }
  }

  private async compressFile(file: string, dayKey: string): Promise<void> {
    const source = path.join(this.historyDir, file);
    const dest = this.gzFilePathForDay(dayKey);
    try {
      await pipeline(createReadStream(source), zlib.createGzip(), createWriteStream(dest));
      await fs.unlink(source);
      this.log.debug('Compressed history file for %s', dayKey);
    } catch (err) {
      this.log.warn(`Failed to compress history file for ${dayKey}:`, err);
      // Remove a partial .gz so the next maintenance pass retries cleanly instead of leaving a truncated file behind.
      await fs.unlink(dest).catch(() => {});
    }
  }

  /** Reads every day-file (compressed or not) whose date falls within [since, until]. */
  private async readRange(since: number, until: number = Date.now()): Promise<ThermostatReading[]> {
    let dayFiles: string[];
    try {
      dayFiles = await fs.readdir(this.historyDir);
    } catch {
      return [];
    }

    const sinceKey = this.dayKeyFor(since);
    const untilKey = this.dayKeyFor(until);

    const relevantFiles = dayFiles.filter(f => {
      const dayKey = this.dayKeyFromFilename(f);
      return dayKey !== null && dayKey >= sinceKey && dayKey <= untilKey;
    });

    const results: ThermostatReading[] = [];
    for (const file of relevantFiles) {
      try {
        const raw = await this.readFileContents(file);
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

  private async readFileContents(file: string): Promise<string> {
    const filePath = path.join(this.historyDir, file);
    if (file.endsWith(GZ_EXT)) {
      const compressed = await fs.readFile(filePath);
      return zlib.gunzipSync(compressed).toString('utf8');
    }
    return fs.readFile(filePath, 'utf8');
  }

  public async query(deviceId: string, since: number, until: number = Date.now()): Promise<ThermostatReading[]> {
    const all = await this.readRange(since, until);
    return all.filter(r => r.deviceId === deviceId);
  }

  /**
   * Deletes whole day-files (compressed or not) outside the retention window —
   * no read/rewrite needed. retentionDays counts calendar days inclusive of
   * today, so 1 keeps only today's file, 7 keeps today plus the previous 6 days.
   */
  public async pruneOldEntries(): Promise<void> {
    if (this.retentionDays <= 0) {
      return; // disabled — e.g. after a persistent write failure
    }
    const cutoffKey = this.dayKeyFor(Date.now() - (this.retentionDays - 1) * 24 * 60 * 60 * 1000);
    let dayFiles: string[];
    try {
      dayFiles = await fs.readdir(this.historyDir);
    } catch {
      return;
    }
    for (const file of dayFiles) {
      const dayKey = this.dayKeyFromFilename(file);
      if (dayKey === null || dayKey >= cutoffKey) {
        continue;
      }
      try {
        await fs.unlink(path.join(this.historyDir, file));
      } catch (err) {
        this.log.warn(`Failed to delete old history file ${file}:`, err);
      }
    }
  }

  public async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
    }
    await this.flush(); // don't lose the last buffered minute
  }
}
