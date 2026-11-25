import type { DaikinOnePlusPlatform } from './platform.js';

/**
 * Fails a HomeKit set request when the write didn't go through, so the Home app reports an error
 * instead of showing a value the thermostat never accepted.
 */
export const assertWritten = (platform: DaikinOnePlusPlatform, written: boolean): void => {
  if (!written) {
    throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
};
