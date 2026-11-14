import { API, APIEvent, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { DaikinOnePlusThermostat } from './platformThermostat.js';
import { DaikinOnePlusAQSensor } from './platformAQI.js';
import { DaikinOnePlusHumidity } from './platformHumidity.js';
import { DaikinOnePlusScheduleSwitch } from './platformScheduleSwitch.js';
import { DaikinOnePlusAwaySwitch } from './platformAwaySwitch.js';
import { DaikinOnePlusStateSwitch } from './platformStateSwitch.js';
import { DaikinApi } from './daikinapi.js';
import { DaikinOnePlusEmergencyHeatSwitch } from './platformEmergencyHeatSwitch.js';
import { DaikinOnePlusOneCleanFan } from './platformOneCleanFan.js';
import { DaikinOnePlusCirculateAirFan } from './platformCirculateAirFan.js';
import { AccessoryContext, Thermostat, ThermostatData, DaikinOptions, EquipmentStatus } from './types.js';
import { DaikinOnePlusOutdoorTemperature } from './platformOutdoorTemperature.js';
import assert from 'node:assert';
import { discoverZones, thermostatIdentity } from './zones.js';
import { HistoryStore } from './historyStore.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DaikinOnePlusPlatform implements DynamicPlatformPlugin {
  // this is used to track restored cached accessories
  private readonly accessories: PlatformAccessory<AccessoryContext>[];
  public readonly api: API;
  public config: DaikinOptions;
  public readonly log: Logging;

  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly daikinApi: DaikinApi;
  private readonly zoneControllers = new Map<string, DaikinOnePlusThermostat>();
  private readonly zoneDiscoveryListeners = new Set<string>();
  private readonly sharedAccessoriesDiscovered = new Set<string>();
  private discoverTimer: NodeJS.Timeout | undefined;

  public readonly historyStore: HistoryStore;
  private pruneTimer: NodeJS.Timeout | undefined;

  public constructor(log: Logging, config: PlatformConfig, api: API) {
    this.accessories = [];
    this.api = api;
    this.log = log;
    this.log.debug = this.debug.bind(this);
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    //Don't start if not configured
    if (!config) {
      throw new Error('No configuration found.');
    }

    assert(
      typeof config.user === 'string' && config.user.length > 0 && typeof config.password === 'string' && config.password.length > 0,
      'No valid Daikin login credentials configured.',
    );

    assert(typeof config.name === 'string', 'No valid name configured.');

    const configuredStoragePath = typeof config.storagePath === 'string' ? config.storagePath.trim() : '';

    const storagePath = configuredStoragePath.length > 0 ? configuredStoragePath : api.user.storagePath();

    this.config = {
      enableAdditionalZoneControls: config.enableAdditionalZoneControls === true,
      debug: !!config.debug,
      user: config.user,
      password: config.password,
      name: config.name,
      includeDeviceName: !!config.includeDeviceName,
      enableEmergencyHeatSwitch: !!config.enableEmergencyHeatSwitch,
      enableOneCleanFan: !!config.enableOneCleanFan,
      enableCirculateAirFan: !!config.enableCirculateAirFan,
      enableScheduleSwitch: !!config.enableScheduleSwitch,
      enableAwaySwitch: !!config.enableAwaySwitch,
      enableStateSwitches: !!config.enableStateSwitches,
      ignoreIndoorAqi: !!config.ignoreIndoorAqi,
      ignoreOutdoorAqi: !!config.ignoreOutdoorAqi,
      ignoreIndoorHumSensor: !!config.ignoreIndoorHumSensor,
      ignoreOutdoorHumSensor: !!config.ignoreOutdoorHumSensor,
      ignoreThermostat: !!config.ignoreThermostat,
      ignoreOutdoorTemp: !!config.ignoreOutdoorTemp,
      autoResumeSchedule: !!config.autoResumeSchedule,
      logRaw: !!config.debug && !!config.logRaw,
      enableHistory: !!config.enableHistory,
      storagePath: storagePath,
      retentionDays: config.retentionDays,
      compressHistoryFiles: config.compressHistoryFiles === undefined ? true : !!config.compressHistoryFiles,
      recordRawData: !!config.recordRawData,
      rawDataFields: config.rawDataFields ?? '',
      enableHistoryPush: !!config.enableHistoryPush,
      pushUrl: typeof config.pushUrl === 'string' ? config.pushUrl.trim() : '',
      pushToken: typeof config.pushToken === 'string' ? config.pushToken.trim() : '',
      pushAuthScheme: typeof config.pushAuthScheme === 'string' ? config.pushAuthScheme : 'bearer',
      pushBodyFormat: typeof config.pushBodyFormat === 'string' ? config.pushBodyFormat : 'readings',
      pushIntervalSeconds: config.pushIntervalSeconds,
      pushMaxBuffer: config.pushMaxBuffer,
      pushBatchSize: config.pushBatchSize,
    };

    this.debug('Debug logging on. Expect lots of messages.');

    this.debug('Using Include Device Name setting of %s.', this.config.includeDeviceName);
    this.debug('Finished initializing platform: %s', this.config.name);

    this.historyStore = new HistoryStore(this.log, this.config);

    this.daikinApi = new DaikinApi(
      this.config.user,
      this.config.password,
      this.log,
      this.config.logRaw,
      this.historyStore,
      this.config.enableAdditionalZoneControls,
    );

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.discover.bind(this));

    // When this event is fired it means Homebridge is shutting down and we should cleanup any resources, such as the history store timer.
    this.api.on(APIEvent.SHUTDOWN, this.shutdown.bind(this));
  }

  private discover(): void {
    this.log.debug('Executed didFinishLaunching callback');

    clearTimeout(this.discoverTimer);

    //If initialized, no need to try and discover devices again.
    if (this.daikinApi.isInitialized()) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.discoverTimer = setTimeout(async () => {
      try {
        // run the method to discover / register your devices as accessories
        await this.discoverDevices();

        //Call discover again in case we failed to initialize the api and discover devices.
        this.discover();
      } catch (error) {
        this.log.error('Discovery failed:', error);
        // Retry discovery on failure
        this.discover();
      }
    }, 10 * 1000);
  }

  public shutdown() {
    clearTimeout(this.discoverTimer);
    this.daikinApi.destroy();
    for (const controller of this.zoneControllers.values()) controller.destroy();
    void this.historyStore.destroy();
  }
  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  public configureAccessory(accessory: PlatformAccessory<AccessoryContext>) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  private async discoverDevices() {
    if (!this.config.user && !this.config.password) {
      this.log.error('Credentials not set. Aborting discovery of devices.');
      return;
    }

    if (!this.daikinApi.isInitialized()) await this.daikinApi.Initialize();

    if (!this.daikinApi.isInitialized()) {
      this.log.error('Unable to retrieve devices. Aborting discovery of devices.');
      return;
    }
    const devices = this.daikinApi.getDeviceList();

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      this.log.info('Found device: %s', device.name);
      const deviceData = device.data;
      this.log.info('Device info: %s', this.daikinApi.describeDevice(deviceData));

      this.discoverThermostat(device);
      if (!this.zoneDiscoveryListeners.has(device.id)) {
        this.zoneDiscoveryListeners.add(device.id);
        this.daikinApi.addListener(device.id, () => this.discoverThermostat(device));
      }
      if (this.sharedAccessoriesDiscovered.has(device.id)) continue;
      this.discoverOutdoorTemp(device);
      this.discoverOutdoorHumSensor(device);
      this.discoverIndoorHumSensor(device);
      this.discoverOutdoorAqi(device, deviceData);
      this.discoverIndoorAqi(device, deviceData);
      this.discoverScheduleSwitch(device);
      this.discoverAwaySwitch(device);
      this.discoverStateSwitches(device);
      this.discoverEmergencyHeatSwitch(device);
      this.discoverOneCleanFan(device);
      this.discoverCirculateAirFan(device);
      this.sharedAccessoriesDiscovered.add(device.id);
    }
  }

  private discoverEmergencyHeatSwitch(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_emergency_heat`);
    this.log.debug('Checking for Emergency Heat Switch...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableEmergencyHeatSwitch) {
      const dName = this.accessoryName(device, 'Emergency Heat');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing emergency heat switch from cache:', existingAccessory.displayName);
        new DaikinOnePlusEmergencyHeatSwitch(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new emergency heat switch:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusEmergencyHeatSwitch(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Emergency Heat switch
      this.log.debug('Removing emergency heat switch from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverOneCleanFan(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_one_clean_fan`);
    this.log.debug('Checking for One Clean Fan...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableOneCleanFan) {
      const dName = this.accessoryName(device, 'One Clean');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing one clean fan from cache:', existingAccessory.displayName);
        new DaikinOnePlusOneCleanFan(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new one clean fan:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusOneCleanFan(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing one clean fan
      this.log.debug('Removing one clean fan from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverCirculateAirFan(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_circ_air_fan`);
    this.log.debug('Checking for Circulate Air Fan...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableCirculateAirFan) {
      const dName = this.accessoryName(device, 'Circulate Air');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing circulate air fan from cache:', existingAccessory.displayName);
        new DaikinOnePlusCirculateAirFan(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new circulate air fan:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusCirculateAirFan(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing one clean fan
      this.log.debug('Removing circulate air fan from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverScheduleSwitch(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_schedule`);
    this.log.debug('Checking for Schedule Switch...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableScheduleSwitch) {
      const dName = this.accessoryName(device, 'Schedule State');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing schedule switch from cache:', existingAccessory.displayName);
        new DaikinOnePlusScheduleSwitch(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new schedule switch:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusScheduleSwitch(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Schedule switch
      this.log.debug('Removing Schedule switch from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverAwaySwitch(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_away`);
    this.log.debug('Checking for Away Switch...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableAwaySwitch) {
      const dName = this.accessoryName(device, 'Away State');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing away switch from cache:', existingAccessory.displayName);
        new DaikinOnePlusAwaySwitch(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new away switch:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusAwaySwitch(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Away switch
      this.log.debug('Removing Away switch from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverStateSwitches(device: Thermostat) {
    this.log.debug('Checking for System State Switches...');

    this.discoverStateSwitch(device, EquipmentStatus.HEATING, 'Heating');
    this.discoverStateSwitch(device, EquipmentStatus.COOLING, 'Cooling');
    this.discoverStateSwitch(device, EquipmentStatus.FAN, 'Fan');
    this.discoverStateSwitch(device, EquipmentStatus.OVERCOOL_DEHUMIDIFYING, 'Overcool');
    this.discoverStateSwitch(device, EquipmentStatus.IDLE, 'Idle');
  }

  private discoverIndoorAqi(device: Thermostat, deviceData: ThermostatData | undefined) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_iaqi`);
    this.log.debug('Checking for indoor Air Quality sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (!this.config.ignoreIndoorAqi) {
      const dName = this.accessoryName(device, 'Indoor AQI');
      if (deviceData && deviceData.aqIndoorAvailable) {
        if (existingAccessory) {
          // the accessory already exists
          existingAccessory.displayName = dName;
          existingAccessory.context.device = device;
          this.log.debug('Restoring existing indoor Air Quality sensor from cache:', existingAccessory.displayName);
          new DaikinOnePlusAQSensor(this, existingAccessory, device.id, this.daikinApi, true);
        } else {
          // the accessory does not yet exist, so we need to create it
          this.log.debug('Adding new indoor Air Quality sensor:', dName);

          const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
          accessory.context.device = device;
          new DaikinOnePlusAQSensor(this, accessory, device.id, this.daikinApi, true);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      } else if (existingAccessory && deviceData?.aqIndoorAvailable === false) {
        this.log.debug('Removing legacy indoor Air Quality Sensor from cache:', existingAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Indoor AQI switch
      this.log.debug('Removing Indoor AQI sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverOutdoorAqi(device: Thermostat, deviceData: ThermostatData | undefined) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_oaqi`);
    this.log.debug('Checking for outdoor Air Quality sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (!this.config.ignoreOutdoorAqi) {
      const dName = this.accessoryName(device, 'Outdoor AQI');
      if (deviceData && deviceData.aqOutdoorAvailable) {
        if (existingAccessory) {
          // the accessory already exists
          existingAccessory.displayName = dName;
          existingAccessory.context.device = device;
          this.log.debug('Restoring existing outdoor Air Quality sensor from cache:', existingAccessory.displayName);
          new DaikinOnePlusAQSensor(this, existingAccessory, device.id, this.daikinApi, false);
        } else {
          // the accessory does not yet exist, so we need to create it
          this.log.debug('Adding new outdoor Air Quality sensor:', dName);

          const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
          accessory.context.device = device;
          new DaikinOnePlusAQSensor(this, accessory, device.id, this.daikinApi, false);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      } else if (existingAccessory && deviceData?.aqOutdoorAvailable === false) {
        this.log.debug('Removing legacy outdoor Air Quality Sensor from cache:', existingAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Outdoor AQI sensor
      this.log.debug('Removing Outdoor AQI sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverIndoorHumSensor(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_ihum`);
    this.log.debug('Checking for indoor humidity sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (!this.config.ignoreIndoorHumSensor) {
      const dName = this.accessoryName(device, 'Indoor Humidity');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing indoor humidity sensor from cache:', existingAccessory.displayName);
        new DaikinOnePlusHumidity(this, existingAccessory, device.id, this.daikinApi, true);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new indoor humidity sensor:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusHumidity(this, accessory, device.id, this.daikinApi, true);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Indoor Humidity sensor
      this.log.debug('Removing Indoor Humidity sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverOutdoorHumSensor(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_ohum`);
    this.log.debug('Checking for outdoor humidity sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (!this.config.ignoreOutdoorHumSensor) {
      const dName = this.accessoryName(device, 'Outdoor Humidity');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing outdoor humidity sensor from cache:', existingAccessory.displayName);
        new DaikinOnePlusHumidity(this, existingAccessory, device.id, this.daikinApi, false);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new outdoor humidity sensor:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusHumidity(this, accessory, device.id, this.daikinApi, false);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Outdoor Humidity sensor
      this.log.debug('Removing Outdoor Humidity sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private discoverThermostat(device: Thermostat) {
    const zones = discoverZones(device);
    // Bind retained accessories even when the first response is unavailable or incomplete.
    for (const accessory of this.accessories) {
      if (accessory.context.device.id !== device.id) continue;
      const number =
        accessory.context.zoneNumber ?? (accessory.UUID === this.api.hap.uuid.generate(thermostatIdentity(device.id, 1)) ? 1 : undefined);
      if (number) accessory.context.zoneNumber = number;
      if (number && !zones.some(zone => zone.number === number)) {
        zones.push({ deviceId: device.id, number, name: accessory.displayName });
      }
    }
    for (const zone of zones) {
      const uuid = this.api.hap.uuid.generate(thermostatIdentity(device.id, zone.number));
      if (this.config.ignoreThermostat) continue;
      let accessory = this.accessories.find(accessory => accessory.UUID === uuid);
      const name = Object.keys(device.data ?? {}).some(key => /^Zone[1-9]\d*Enable$/.test(key))
        ? zone.name
        : device.data && zone.number === 1
          ? this.accessoryName(device, 'Thermostat')
          : zone.name;
      if (!accessory) {
        accessory = new this.api.platformAccessory<AccessoryContext>(name, uuid);
        accessory.context.device = device;
        accessory.context.zoneNumber = zone.number;
        this.accessories.push(accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      accessory.context.device = device;
      accessory.context.zoneNumber = zone.number;
      const controller = this.zoneControllers.get(uuid);
      if (controller) controller.rename(name);
      else {
        accessory.displayName = name;
        this.zoneControllers.set(uuid, new DaikinOnePlusThermostat(this, accessory, device.id, this.daikinApi, zone.number));
      }
      this.api.updatePlatformAccessories([accessory]);
    }
    for (const accessory of [...this.accessories]) {
      if (accessory.context.device.id !== device.id || !accessory.context.zoneNumber) continue;
      const enabled = device.data?.[`Zone${accessory.context.zoneNumber}Enable`];
      // Only explicit disabled metadata is grounds for removal. Missing fields may be transient.
      if (!this.config.ignoreThermostat && enabled !== 0 && enabled !== 255) continue;
      this.zoneControllers.get(accessory.UUID)?.destroy();
      this.zoneControllers.delete(accessory.UUID);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.splice(this.accessories.indexOf(accessory), 1);
    }
  }

  private discoverOutdoorTemp(device: Thermostat) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_otemp`);
    this.log.debug('checking for Outdoor Temperature...');
    const existingaccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (!this.config.ignoreOutdoorTemp) {
      const dname = this.accessoryName(device, 'Outdoor Temperature');
      if (existingaccessory) {
        // the accessory already exists
        existingaccessory.displayName = dname;
        existingaccessory.context.device = device;
        this.log.debug('restoring existing Outdoor Temperature from cache:', existingaccessory.displayName);
        new DaikinOnePlusOutdoorTemperature(this, existingaccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('adding new Outdoor Temperature:', dname);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dname, uuid);
        accessory.context.device = device;
        new DaikinOnePlusOutdoorTemperature(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingaccessory) {
      this.log.debug('removing Outdoor Temperature from cache:', existingaccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingaccessory]);
    }
  }

  private discoverStateSwitch(device: Thermostat, state: EquipmentStatus, name: string) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_${name}_state`);
    this.log.debug(`Checking for system ${name} state switch...`);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableStateSwitches) {
      const dName = this.accessoryName(device, name);
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug(`Restoring existing system ${name} state switch from cache:`, existingAccessory.displayName);
        new DaikinOnePlusStateSwitch(this, existingAccessory, device.id, this.daikinApi, state);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug(`Adding new system ${name} state switch:`, dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusStateSwitch(this, accessory, device.id, this.daikinApi, state);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing state switch
      this.log.debug(`Removing system ${name} switch from cache:`, existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  private accessoryName(device: Thermostat, accessory: string) {
    return this.config.includeDeviceName ? `${device.name} ${accessory}` : accessory;
  }

  private debug(message: string, ...parameters: unknown[]): void {
    if (this.config.debug) {
      this.log.info(message, ...parameters);
    }
  }
}
