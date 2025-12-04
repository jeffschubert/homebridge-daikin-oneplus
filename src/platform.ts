import { API, APIEvent, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { DaikinOnePlusThermostat } from './platformThermostat.js';
import { DaikinOnePlusAQSensor } from './platformAQI.js';
import { DaikinOnePlusHumidity } from './platformHumidity.js';
import { DaikinOnePlusScheduleSwitch } from './platformScheduleSwitch.js';
import { DaikinOnePlusAwaySwitch } from './platformAwaySwitch.js';
import { DaikinApi } from './daikinapi.js';
import { DaikinOnePlusEmergencyHeatSwitch } from './platformEmergencyHeatSwitch.js';
import { DaikinOnePlusOneCleanFan } from './platformOneCleanFan.js';
import { DaikinOnePlusCirculateAirFan } from './platformCirculateAirFan.js';
import { AccessoryContext, Thermostat, ThermostatData, DaikinOptions } from './types.js';
import { DaikinOnePlusOutdoorTemperature } from './platformOutdoorTemperature.js';
import assert from 'node:assert';

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
  private discoverTimer: NodeJS.Timeout | undefined;

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

    this.config = {
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
      ignoreIndoorAqi: !!config.ignoreIndoorAqi,
      ignoreOutdoorAqi: !!config.ignoreOutdoorAqi,
      ignoreIndoorHumSensor: !!config.ignoreIndoorHumSensor,
      ignoreOutdoorHumSensor: !!config.ignoreOutdoorHumSensor,
      ignoreThermostat: !!config.ignoreThermostat,
      ignoreOutdoorTemp: !!config.ignoreOutdoorTemp,
      autoResumeSchedule: !!config.autoResumeSchedule,
    };

    this.debug('Debug logging on. Expect lots of messages.');

    this.debug('Using Include Device Name setting of %s.', this.config.includeDeviceName);
    this.debug('Finished initializing platform: %s', this.config.name);

    this.daikinApi = new DaikinApi(this.config.user, this.config.password, this.log);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.discover.bind(this));
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

    await this.daikinApi.Initialize();

    if (!this.daikinApi.isInitialized()) {
      this.log.error('Unable to retrieve devices. Aborting discovery of devices.');
      return;
    }
    const devices = this.daikinApi.getDeviceList();

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      this.log.info('Found device: %s', device.name);
      const deviceData = await this.daikinApi.getDeviceData(device.id);

      this.discoverThermostat(device);
      this.discoverOutdoorTemp(device);
      this.discoverOutdoorHumSensor(device);
      this.discoverIndoorHumSensor(device);
      this.discoverOutdoorAqi(device, deviceData);
      this.discoverIndoorAqi(device, deviceData);
      this.discoverScheduleSwitch(device);
      this.discoverAwaySwitch(device);
      this.discoverEmergencyHeatSwitch(device);
      this.discoverOneCleanFan(device);
      this.discoverCirculateAirFan(device);
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
      } else if (existingAccessory) {
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
      } else if (existingAccessory) {
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
    const uuid = this.api.hap.uuid.generate(`${device.id}_tstat`);
    this.log.debug('Checking for thermostat...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (!this.config.ignoreThermostat) {
      const dName = this.accessoryName(device, 'Thermostat');
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.debug('Restoring existing thermostat from cache:', existingAccessory.displayName);
        new DaikinOnePlusThermostat(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.debug('Adding new thermostat:', dName);

        const accessory = new this.api.platformAccessory<AccessoryContext>(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusThermostat(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      this.log.debug('Removing Thermostat from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
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

  private accessoryName(device: Thermostat, accessory: string) {
    return this.config.includeDeviceName ? `${device.name} ${accessory}` : accessory;
  }

  private debug(message: string, ...parameters: unknown[]): void {
    if (this.config.debug) {
      this.log.info(message, ...parameters);
    }
  }
}
