import { Logging } from 'homebridge';
import { Thermostat, ThermostatData, ThermostatUpdate } from './types.js';

/**
 * Polling cadence for a transport, used by DaikinApi's update scheduler.
 */
export interface TransportTiming {
  /** Hold-off before re-reading after a write, for APIs that echo stale data post-write. */
  writeDelayMs: number;
  /** Minimum interval between reads while a HomeKit controller is actively interacting. */
  foregroundRefreshMs: number;
  /** Interval between reads otherwise. */
  backgroundRefreshMs: number;
}

/**
 * Moves thermostat data between DaikinApi and a Daikin endpoint. Implementations translate their
 * wire format to and from ThermostatData so everything above this layer is transport-agnostic.
 */
export interface DaikinTransport {
  readonly timing: TransportTiming;
  /** Prepares the transport (e.g. authenticates). Returns false if it can't be used. */
  initialize(): Promise<boolean>;
  listDevices(): Promise<Thermostat[]>;
  fetchData(deviceId: string): Promise<ThermostatData | undefined>;
  /**
   * Sends the given writable fields to the device. Returns false on a rejected request;
   * throws on a transport-level failure.
   */
  write(deviceId: string, update: ThermostatUpdate): Promise<boolean>;
}

export const logError = (log: Logging, message: string, error: unknown): boolean => {
  log.error(message);
  log.error(String(error));
  return false;
};
