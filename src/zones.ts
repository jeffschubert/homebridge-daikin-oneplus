import { Thermostat, ThermostatData, ThermostatUpdate } from './types.js';

export interface Zone {
  deviceId: string;
  number: number;
  name: string;
}

export const zoneField = (zone: number, field: string): string => (zone === 1 ? field : `Zone${zone}${field}`);
export const zoneIdentity = (deviceId: string, zone: number): string => `${deviceId}_zone_${zone}`;
export const thermostatIdentity = (deviceId: string, zone: number): string =>
  zone === 1 ? `${deviceId}_tstat` : `${zoneIdentity(deviceId, zone)}_tstat`;

export function discoverZones(device: Thermostat): Zone[] {
  if (!device.data) return [];
  const metadata = Object.keys(device.data).filter(key => /^Zone[1-9]\d*Enable$/.test(key));
  const numbers = metadata.length === 0 ? [1] : metadata.filter(key => device.data![key] === 1).map(key => Number(key.slice(4, -6)));
  return numbers
    .sort((a, b) => a - b)
    .map(number => {
      const configured = device.data![`Zone${number}Name`];
      const name = typeof configured === 'string' ? configured.trim() : '';
      return {
        deviceId: device.id,
        number,
        name: name && name !== `Zone${number}` ? name : number === 1 ? device.name : `${device.name} Zone ${number}`,
      };
    });
}

// Additional-zone write names are proposed equivalents and require the experimental opt-in.
export function zoneUpdate(zone: number, values: ThermostatUpdate): ThermostatUpdate {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [zoneField(zone, key), value]));
}

export function zoneData(data: ThermostatData, zone: number): ThermostatData {
  if (zone === 1) return data;
  const prefix = `Zone${zone}`;
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key.startsWith(prefix) && /^[a-z]/.test(key.slice(prefix.length)))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  ) as unknown as ThermostatData;
}
