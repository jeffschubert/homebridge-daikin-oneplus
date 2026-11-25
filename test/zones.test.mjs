import test from 'node:test';
import assert from 'node:assert/strict';
import { DaikinApi } from '../dist/daikinapi.js';
import { CloudTransport } from '../dist/cloudTransport.js';
import { discoverZones, zoneData, zoneField, thermostatIdentity } from '../dist/zones.js';
import { HistoryStore } from '../dist/historyStore.js';

const log = Object.assign(() => {}, { debug() {}, info() {}, warn() {}, error() {} });
const fixture = () => ({ tempIndoor: 19.6, humIndoor: 52, hspActive: 19.4, cspActive: 23.9,
  hspHome: 19.4, cspHome: 23.9, mode: 3, equipmentStatus: 5, schedEnabled: false,
  Zone1Enable: 1, Zone1Name: 'Zone1', Zone2Enable: 1, Zone2Name: 'Upstairs',
  Zone2tempIndoor: 18.9, Zone2humIndoor: 54, Zone2hspActive: 18.9, Zone2cspActive: 23.9,
  Zone2hspHome: 19.4, Zone2cspHome: 22.8, Zone2mode: 3, Zone2equipmentStatus: 5,
  Zone2schedEnabled: true, Zone2schedOverride: 0, Zone2geofencingAway: false,
  Zone3Enable: 255, Zone4Enable: 255, ZoneInt1tempIndoor: 255, CurrentViewedZone: 1 });
const device = (id = 'synthetic-a', data = fixture()) => ({ id, name: 'Main Room', model: 'ONEPLUS', firmwareVersion: '4.1.6', data });
const history = { async record() {} };
function setup(t, controls = true, devices = [device()]) {
  const transport = new CloudTransport('', '', log);
  transport._token = { accessToken: 'synthetic-token' };
  transport._tokenExpiration = new Date(Date.now() + 3600000);
  const api = new DaikinApi(transport, log, false, history, undefined, controls);
  api._devices = new Map(devices.map(d => [d.id, d]));
  for (const d of devices) api.readTimes.set(d.id, Date.now());
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: options?.body && JSON.parse(options.body), method: options?.method });
    return { ok: true, status: 200, json: async () => fixture() };
  });
  t.after(() => api.destroy());
  return { api, requests };
}

test('legacy devices, enabled zones, names, placeholders, and arbitrary additional zones', () => {
  assert.deepEqual(discoverZones(device('a', { tempIndoor: 20 })), [{ deviceId: 'a', number: 1, name: 'Main Room' }]);
  assert.deepEqual(discoverZones(device()).map(z => [z.number, z.name]), [[1, 'Main Room'], [2, 'Upstairs']]);
  const data = fixture(); data.Zone3Enable = 1; data.Zone3Name = 'Office'; data.Zone4Enable = 0;
  assert.deepEqual(discoverZones(device('a', data)).map(z => z.number), [1, 2, 3]);
  delete data.Zone2Enable;
  assert.deepEqual(discoverZones(device('a', data)).map(z => z.number), [1, 3]);
  assert.deepEqual(discoverZones({ id: 'a', name: 'A' }), []);
  assert.equal(zoneField(1, 'tempIndoor'), 'tempIndoor');
  assert.equal(zoneField(3, 'tempIndoor'), 'Zone3tempIndoor');
  assert.equal(zoneData(data, 2).tempIndoor, 18.9);
});

test('identities preserve main UUID seed, ignore names, and distinguish devices and zones', () => {
  assert.equal(thermostatIdentity('a', 1), 'a_tstat');
  const identities = ['a', 'b'].flatMap(id => [1, 2, 3].map(n => thermostatIdentity(id, n)));
  assert.equal(new Set(identities).size, 6);
  const d = device(); const before = thermostatIdentity(d.id, 2); d.data.Zone2Name = 'Renamed';
  assert.equal(thermostatIdentity(d.id, discoverZones(d)[1].number), before);
});

test('reads isolate every zone field, reject missing/255/disabled/expired values', t => {
  const { api } = setup(t);
  for (const [field, expected] of [['tempIndoor', 18.9], ['humIndoor', 54], ['mode', 3], ['equipmentStatus', 5], ['hspActive', 18.9], ['cspActive', 23.9]]) {
    assert.equal(api.getZoneValue('synthetic-a', 2, field), expected);
  }
  assert.equal(api.getZoneValue('synthetic-a', 1, 'tempIndoor'), 19.6);
  const data = api._devices.get('synthetic-a').data;
  delete data.Zone2tempIndoor; assert.throws(() => api.getZoneValue('synthetic-a', 2, 'tempIndoor'));
  data.Zone2tempIndoor = 255; assert.throws(() => api.getZoneValue('synthetic-a', 2, 'tempIndoor'));
  data.Zone2Enable = 0; assert.throws(() => api.getZoneValue('synthetic-a', 2, 'mode'));
  api.readTimes.set('synthetic-a', 0); assert.throws(() => api.getZoneValue('synthetic-a', 1, 'mode'));
});

test('single Auto threshold immediately retains other active threshold, with independent schedule override', async t => {
  const { api, requests } = setup(t);
  assert.equal(await api.setTargetTemps('synthetic-a', undefined, 20), true);
  assert.deepEqual(requests[0].body, { hspHome: 20, cspHome: 23.9 });
  assert.equal(await api.setTargetTemps('synthetic-a', undefined, undefined, 24, 2), true);
  assert.deepEqual(requests[1].body, { Zone2hspHome: 18.9, Zone2cspHome: 24, Zone2schedOverride: 1 });
  assert.equal(api.getZoneValue('synthetic-a', 2, 'cspActive'), 24);
  assert.ok(requests.every(r => r.url.endsWith('/deviceData/synthetic-a')));
  assert.ok(requests.every(r => !('CurrentViewedZone' in r.body)));
});

test('main and prefixed heat/cool/mode writes including third zone', async t => {
  const { api, requests } = setup(t);
  for (const zone of [1, 2, 3]) {
    if (zone === 3) Object.assign(api._devices.get('synthetic-a').data, { Zone3Enable: 1, Zone3mode: 3, Zone3schedEnabled: false });
    await api.setTargetState('synthetic-a', 1, zone);
    await api.setTargetTemps('synthetic-a', 21, undefined, undefined, zone);
    await api.setTargetState('synthetic-a', 2, zone);
    await api.setTargetTemps('synthetic-a', 24, undefined, undefined, zone);
    const prefix = zone === 1 ? '' : `Zone${zone}`;
    const override = zone === 2 ? { Zone2schedOverride: 1 } : {};
    assert.deepEqual(requests.at(-4).body, { [`${prefix}mode`]: 1 });
    assert.deepEqual(requests.at(-3).body, { [`${prefix}hspHome`]: 21, ...override });
    assert.deepEqual(requests.at(-1).body, { [`${prefix}cspHome`]: 24, ...override });
  }
});

test('concurrent zones and devices cannot mix; same-zone threshold writes serialize', async t => {
  const { api, requests } = setup(t, true, [device(), device('synthetic-b')]);
  await Promise.all([
    api.setTargetTemps('synthetic-a', undefined, 20),
    api.setTargetTemps('synthetic-a', undefined, 19, undefined, 2),
    api.setTargetTemps('synthetic-b', undefined, undefined, 25, 2),
    api.setTargetTemps('synthetic-a', undefined, undefined, 26),
  ]);
  assert.deepEqual(requests.find(r => r.body.cspHome === 26).body, { hspHome: 20, cspHome: 26 });
  assert.deepEqual(requests.find(r => r.url.endsWith('synthetic-b')).body, { Zone2hspHome: 18.9, Zone2cspHome: 25, Zone2schedOverride: 1 });
  assert.equal(api.getZoneValue('synthetic-a', 2, 'cspActive'), 23.9);
});

test('controls default off: no PUT or optimistic changes, including mode', async t => {
  const { api, requests } = setup(t, false);
  const defaultApi = new DaikinApi(new CloudTransport('', '', log), log, false, history);
  await assert.rejects(defaultApi.setTargetState('synthetic-a', 1, 2), /disabled/);
  defaultApi.destroy();
  await assert.rejects(api.setTargetTemps('synthetic-a', undefined, 20, undefined, 2), /disabled/);
  await assert.rejects(api.setTargetState('synthetic-a', 1, 2), /disabled/);
  assert.equal(requests.length, 0);
  assert.equal(api.getZoneValue('synthetic-a', 2, 'mode'), 3);
});

test('failed writes leave confirmed cache intact and next write can succeed', async t => {
  const { api } = setup(t);
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'synthetic failure' });
  assert.equal(await api.setTargetState('synthetic-a', 1, 2), false);
  assert.equal(await api.setTargetTemps('synthetic-a', undefined, 20, undefined, 2), false);
  assert.equal(api.getZoneValue('synthetic-a', 2, 'mode'), 3);
  assert.equal(api.getZoneValue('synthetic-a', 2, 'hspActive'), 18.9);
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  assert.equal(await api.setTargetState('synthetic-a', 1, 2), true);
});

test('polling fetches each physical device once, replaces incomplete readings, reconciles optimistic state', async t => {
  const { api, requests } = setup(t, true, [device(), device('synthetic-b')]);
  let calls = 0;
  api.addListener('synthetic-a', () => calls++);
  await api.getData();
  assert.equal(requests.length, 2);
  assert.equal(calls, 2);
  await api.setTargetTemps('synthetic-a', undefined, 21, undefined, 2);
  api._noUpdateBeforeMs = 0;
  await api.getData();
  assert.equal(api.getZoneValue('synthetic-a', 2, 'hspActive'), 18.9);
  const partial = fixture(); delete partial.Zone2tempIndoor;
  globalThis.fetch = async () => ({ ok: true, json: async () => partial });
  api._noUpdateBeforeMs = 0;
  await api.getData();
  assert.throws(() => api.getZoneValue('synthetic-a', 2, 'tempIndoor'));
});

test('history preserves main record shape and adds explicit additional-zone identity', async () => {
  const store = new HistoryStore(log, {});
  const readings = [];
  store.registerConsumer({ onReading: r => readings.push(r) });
  const d = device();
  await store.record(d.id, d.data, 19.4);
  await store.record(d.id, zoneData(d.data, 2), 18.9, discoverZones(d)[1]);
  assert.equal('zoneNumber' in readings[0], false);
  assert.equal(readings[0].indoorTemperature, 19.6);
  assert.equal(readings[1].deviceId, d.id);
  assert.equal(readings[1].zoneNumber, 2);
  assert.equal(readings[1].zoneName, 'Upstairs');
  assert.equal(readings[1].indoorTemperature, 18.9);
  await store.destroy();
});

// Real HAP characteristics exercise HomeKit error propagation and accessory restoration.
import * as hap from 'hap-nodejs';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory.js';
import { DaikinOnePlusPlatform } from '../dist/platform.js';
function platformSetup(t, controls = false) {
  const registered = [], removed = [];
  const homebridge = {
    hap, platformAccessory: PlatformAccessory, user: { storagePath: () => '/private/tmp' }, on() {},
    registerPlatformAccessories(_plugin, _platform, accessories) { registered.push(...accessories); },
    unregisterPlatformAccessories(_plugin, _platform, accessories) { removed.push(...accessories); },
    updatePlatformAccessories() {},
  };
  const platform = new DaikinOnePlusPlatform(log, { name: 'Synthetic', user: 'synthetic', password: 'synthetic', enableAdditionalZoneControls: controls }, homebridge);
  const api = platform.daikinApi;
  api._devices.set('synthetic-a', device());
  api.readTimes.set('synthetic-a', Date.now());
  t.after(() => platform.shutdown());
  return { platform, api, registered, removed };
}

test('HomeKit creates separate accessories, restores the legacy UUID, renames without duplicate listeners, removes explicitly disabled zones', async t => {
  const { platform, api, registered, removed } = platformSetup(t);
  const d = api._devices.get('synthetic-a');
  const legacy = new PlatformAccessory('Thermostat', hap.uuid.generate('synthetic-a_tstat'));
  legacy.context.device = d;
  platform.configureAccessory(legacy);
  platform.discoverThermostat(d);
  assert.equal(registered.length, 1);
  assert.equal(legacy.displayName, 'Main Room');
  assert.equal(registered[0].displayName, 'Upstairs');
  const upstairs = registered[0].getService(hap.Service.Thermostat);
  assert.ok(Math.abs(await upstairs.getCharacteristic(hap.Characteristic.CurrentTemperature).handleGetRequest() - 18.9) < 1e-9);
  assert.equal(await upstairs.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity).handleGetRequest(), 54);
  const listenerCount = api._listeners.get(d.id).size;
  d.data.Zone2Name = 'Office';
  platform.discoverThermostat(d);
  assert.equal(registered.length, 1);
  assert.equal(api._listeners.get(d.id).size, listenerCount);
  assert.equal(registered[0].displayName, 'Office');
  delete d.data.Zone2Enable;
  delete d.data.Zone2tempIndoor;
  platform.discoverThermostat(d);
  assert.equal(removed.length, 0);
  await assert.rejects(upstairs.getCharacteristic(hap.Characteristic.CurrentTemperature).handleGetRequest(), error => error === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  d.data = undefined;
  platform.discoverThermostat(d);
  assert.equal(removed.length, 0);
  d.data = fixture(); d.data.Zone2Enable = 0;
  platform.discoverThermostat(d);
  assert.equal(removed.length, 1);
  assert.equal(api._listeners.get(d.id).size, listenerCount - 1);
  d.data.Zone2Enable = 1;
  platform.discoverThermostat(d);
  assert.equal(registered.length, 2);
  assert.equal(api._listeners.get(d.id).size, listenerCount);
  assert.equal(registered[0].UUID, registered[1].UUID);
});

test('HomeKit setters return communication errors with no PUT when zone controls are disabled', async t => {
  const { platform, api, registered } = platformSetup(t);
  let puts = 0;
  t.mock.method(globalThis, 'fetch', async () => { puts++; throw new Error('Unexpected live access'); });
  platform.discoverThermostat(api._devices.get('synthetic-a'));
  const service = registered[1].getService(hap.Service.Thermostat);
  for (const [type, value] of [[hap.Characteristic.HeatingThresholdTemperature, 20], [hap.Characteristic.TargetHeatingCoolingState, 1], [hap.Characteristic.TemperatureDisplayUnits, 1]]) {
    await assert.rejects(service.getCharacteristic(type).handleSetRequest(value), error => error === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
  assert.equal(puts, 0);
});

test('discovery uses the initial poll cache and repeated poll notifications do not duplicate accessories', async t => {
  const { platform, api, registered } = platformSetup(t);
  t.mock.method(api, 'Initialize', async () => { api._isInitialized = true; });
  t.mock.method(api, 'getDeviceData', async () => { throw new Error('Discovery must use cached data'); });
  await platform.discoverDevices();
  const thermostats = registered.filter(a => a.context.zoneNumber);
  assert.equal(thermostats.length, 2);
  const count = api._listeners.get('synthetic-a').size;
  const totalAccessories = registered.length;
  await platform.discoverDevices();
  assert.equal(registered.length, totalAccessories);
  for (let i = 0; i < 3; i++) api.notifyListeners('synthetic-a');
  assert.equal(registered.filter(a => a.context.zoneNumber).length, 2);
  assert.equal(api._listeners.get('synthetic-a').size, count);
  const other = device('synthetic-b');
  api._devices.set(other.id, other); api.readTimes.set(other.id, Date.now());
  platform.discoverThermostat(other);
  const all = registered.filter(a => a.context.zoneNumber);
  assert.equal(new Set(all.map(a => a.UUID)).size, 4);
});

test('independent schedules work in both directions; missing counterpart or schedule and crossed thresholds never PUT', async t => {
  const { api, requests } = setup(t);
  const data = api._devices.get('synthetic-a').data;
  data.schedEnabled = true; data.Zone2schedEnabled = false;
  await api.setTargetTemps('synthetic-a', undefined, 20);
  await api.setTargetTemps('synthetic-a', undefined, 20, undefined, 2);
  assert.deepEqual(requests[0].body, { hspHome: 20, cspHome: 23.9, schedOverride: 1 });
  assert.deepEqual(requests[1].body, { Zone2hspHome: 20, Zone2cspHome: 23.9 });
  const cached = api._devices.get('synthetic-a').data;
  delete cached.Zone2cspActive;
  await assert.rejects(api.setTargetTemps('synthetic-a', undefined, 21, undefined, 2), /unavailable/);
  cached.Zone2cspActive = 24; delete cached.Zone2schedEnabled;
  await assert.rejects(api.setTargetTemps('synthetic-a', undefined, 21, undefined, 2), /schedule/);
  cached.Zone2schedEnabled = false;
  assert.equal(await api.setTargetTemps('synthetic-a', undefined, 30, undefined, 2), false);
  assert.equal(requests.length, 2);
});

test('read/write races discard old poll responses and preserve write delay before reconciliation', async t => {
  const { api } = setup(t);
  let resolveRead;
  const read = new Promise(resolve => { resolveRead = resolve; });
  let getCalls = 0;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === 'PUT') return { ok: true, status: 200 };
    getCalls++;
    return { ok: true, json: async () => read };
  };
  const polling = api.getData();
  await api.setTargetTemps('synthetic-a', undefined, 21, undefined, 2);
  resolveRead(fixture());
  await polling;
  assert.equal(getCalls, 1);
  assert.equal(api.getZoneValue('synthetic-a', 2, 'hspActive'), 21);
  assert.ok(api._noUpdateBeforeMs - api._monotonic_clock_ms() > 14000);
  globalThis.fetch = async () => ({ ok: true, json: async () => fixture() });
  api._noUpdateBeforeMs = 0;
  await api.getData();
  assert.equal(api.getZoneValue('synthetic-a', 2, 'hspActive'), 18.9);
});

test('third-zone reads never include Zone30 or ZoneInt placeholders', t => {
  const data = fixture();
  Object.assign(data, { Zone3Enable: 1, Zone3tempIndoor: 21, Zone3humIndoor: 45, Zone3mode: 1, Zone3equipmentStatus: 3,
    Zone3hspActive: 21, Zone3cspActive: 25, Zone30tempIndoor: 99, ZoneInt3tempIndoor: 255 });
  const { api } = setup(t, true, [device('synthetic-a', data)]);
  assert.equal(api.getZoneValue('synthetic-a', 3, 'tempIndoor'), 21);
  assert.equal(api.getZoneValue('synthetic-a', 3, 'humIndoor'), 45);
  assert.equal(zoneData(data, 3).tempIndoor, 21);
  assert.equal('0tempIndoor' in zoneData(data, 3), false);
});

test('transient GET failure preserves accessories and confirmed data without extending freshness', async t => {
  const { platform, api, removed } = platformSetup(t);
  const d = api._devices.get('synthetic-a');
  platform.discoverThermostat(d);
  const before = api.readTimes.get(d.id);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Synthetic offline'); });
  await api.getData();
  platform.discoverThermostat(d);
  assert.equal(removed.length, 0);
  assert.equal(api.readTimes.get(d.id), before);
  assert.equal(api.getZoneValue(d.id, 2, 'tempIndoor'), 18.9);
  api.readTimes.set(d.id, Date.now() - 11 * 60000);
  assert.throws(() => api.getZoneValue(d.id, 2, 'tempIndoor'), /expired/);
});

test('legacy names and ignoreThermostat work for restored accessories without zone context', t => {
  const { platform, api, registered, removed } = platformSetup(t);
  const d = device('synthetic-legacy', { mode: 3, tempIndoor: 20 });
  api._devices.set(d.id, d); api.readTimes.set(d.id, Date.now());
  const restored = new PlatformAccessory('Thermostat', hap.uuid.generate(thermostatIdentity(d.id, 1)));
  restored.context.device = d;
  platform.configureAccessory(restored);
  platform.discoverThermostat(d);
  assert.equal(restored.displayName, 'Thermostat');
  assert.equal(registered.length, 0);
  platform.config.ignoreThermostat = true;
  platform.discoverThermostat(d);
  assert.equal(removed[0], restored);
});

test('setpoint writes skip the schedule hold when the transport has no schedule', async t => {
  const writes = [];
  const transport = {
    timing: { writeDelayMs: 2000, foregroundRefreshMs: 5000, backgroundRefreshMs: 60000 },
    capabilities: { outdoorSensors: false, schedule: false, away: false, oneClean: false, circulateFanSpeed: false, targetHumidity: false },
    write: async (_id, update) => { writes.push(update); return true; },
  };
  const api = new DaikinApi(transport, log, false, history);
  const { schedEnabled, ...data } = fixture();
  api._devices = new Map([['synthetic-a', device('synthetic-a', data)]]);
  api.readTimes.set('synthetic-a', Date.now());
  t.after(() => api.destroy());
  assert.equal(await api.setTargetTemps('synthetic-a', undefined, 20), true);
  assert.deepEqual(writes, [{ hspHome: 20, cspHome: 23.9 }]);
});
