import { Logging } from 'homebridge';
import Bonjour from 'bonjour-service';

/**
 * A thermostat advertising the Daikin One Local API over mDNS.
 */
export interface DiscoveredThermostat {
  /** The thermostat's name, from the mDNS instance name. */
  name: string;
  /** IPv4 address, or the advertised .local hostname when no address was resolved. */
  host: string;
  hostname: string;
  port: number;
  mac: string;
  model: string;
  firmware: string;
}

type TxtRecord = Record<string, unknown>;

const txtString = (txt: TxtRecord | undefined, key: string): string | undefined => {
  const value = txt?.[key];
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim() || undefined;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString().trim() || undefined;
  }
  return undefined;
};

const isIPv4 = (address: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address);

/**
 * Browses `_http._tcp` for the given time and returns the services that advertise the Daikin One
 * Local API (identified by its `api_ver`, `mac` and `model` TXT fields).
 */
export const discoverThermostats = async (timeoutMs: number, log: Logging): Promise<DiscoveredThermostat[]> => {
  const found = new Map<string, DiscoveredThermostat>();
  const bonjour = new Bonjour(undefined, (error: unknown) => log.debug('mDNS error: %s', String(error)));
  try {
    const browser = bonjour.find({ type: 'http' }, service => {
      const txt = service.txt as TxtRecord | undefined;
      const mac = txtString(txt, 'mac')?.toLowerCase();
      const model = txtString(txt, 'model');
      if (!mac || !model || !txtString(txt, 'api_ver')) {
        return;
      }
      const hostname = service.host?.replace(/\.$/, '') ?? '';
      const address = service.addresses?.find(isIPv4) ?? service.referer?.address;
      const host = address && isIPv4(address) ? address : hostname;
      if (!host) {
        return;
      }
      found.set(mac, {
        name: service.name,
        host,
        hostname,
        port: service.port || 80,
        mac,
        model,
        firmware: txtString(txt, 'firmware') ?? '',
      });
    });
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    browser.stop();
  } finally {
    bonjour.destroy();
  }
  return [...found.values()];
};
