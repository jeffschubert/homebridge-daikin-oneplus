import { Logging } from 'homebridge';
import { Thermostat } from './types.js';

const normalize = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

const sameModel = (a: Thermostat, b: Thermostat) => !a.model || !b.model || normalize(a.model) === normalize(b.model);

/**
 * Maps each discovered device's transport ID to the stable ID its accessories were created under,
 * so switching between cloud and local mode keeps existing HomeKit accessories.
 *
 * A device whose ID matches a known device keeps it. Otherwise it takes the ID of the one unclaimed
 * known device with the same name and model. Devices without a match keep their own ID.
 */
export const resolveDeviceIds = (discovered: Thermostat[], known: Thermostat[], log: Logging): Map<string, string> => {
  const knownById = new Map(known.map(device => [device.id, device]));
  const resolved = new Map<string, string>();
  const claimed = new Set<string>();

  for (const device of discovered) {
    if (knownById.has(device.id)) {
      resolved.set(device.id, device.id);
      claimed.add(device.id);
    }
  }

  for (const device of discovered) {
    if (resolved.has(device.id)) {
      continue;
    }
    const name = normalize(device.name);
    const candidates = [...knownById.values()].filter(
      candidate => !claimed.has(candidate.id) && name && normalize(candidate.name) === name && sameModel(candidate, device),
    );
    if (candidates.length === 0) {
      continue;
    }

    const sameNamed = discovered.filter(other => normalize(other.name) === name).length;
    if (candidates.length > 1 || sameNamed > 1) {
      log.warn(
        'Device %s [%s] could belong to existing accessories for %s, but its name is ambiguous, so new accessories ' +
          'will be created. In local mode, set its deviceId to the existing device ID to keep them.',
        device.id,
        device.name,
        candidates.map(candidate => candidate.id).join(', '),
      );
      continue;
    }

    const match = candidates[0];
    log.info('Matched device %s [%s] to existing accessories for %s.', device.id, device.name, match.id);
    resolved.set(device.id, match.id);
    claimed.add(match.id);
  }

  return resolved;
};
