import { 
  API, 
  DynamicPlatformPlugin, 
  Logger, 
  PlatformAccessory, 
  PlatformConfig, 
  Service, 
  Characteristic, 
  LogLevel, 
  APIEvent, 
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { DaikinOnePlusThermostat } from './platformThermostat';
import { DaikinOnePlusAQSensor } from './platformAQI';
import { DaikinOnePlusHumidity } from './platformHumidity';
import { DaikinOnePlusAwaySwitch } from './platformAwaySwitch';
import { DaikinApi, LoggerLevel, LogMessage } from './daikinapi';
import { DaikinOnePlusEmergencyHeatSwitch } from './platformEmergencyHeatSwitch';
import { DaikinOnePlusOneCleanFan } from './platformOneCleanFan';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class DaikinOnePlusPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private readonly daikinApi!: DaikinApi;
  private discoverTimer!: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    //Don't start if not configured
    if(!this.config){
      this.log.error('Not configured.');
      return;
    }
    if(!this.config.user || !this.config.password) {
      this.log.error('No Daikin login credentials configured.');
    }

    if(!this.config.refreshInterval){
      this.config.refreshInterval = 10;
      this.log.warn('Refresh Interval not set. Using default of 10 seconds.');
    }
    this.log.debug(`Using refresh interval of ${this.config.refreshInterval} seconds`);

    if(this.config.includeDeviceName === undefined) {
      this.config.includeDeviceName = false;
      this.log.warn('Include Device Name not set. Using default of false.');
    }
    this.log.debug(`Using Include Device Name setting of ${this.config.includeDeviceName}`);
    
    this.log.debug(`Finished initializing platform: ${this.config.name}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logMessage: LogMessage = (level: LoggerLevel, message: string, ...parameters: any[]): void => {
      let logLevel: LogLevel = LogLevel.INFO;
      switch(level){
        case LoggerLevel.INFO: logLevel = LogLevel.INFO; break;
        case LoggerLevel.WARN: logLevel = LogLevel.WARN; break;
        case LoggerLevel.ERROR: logLevel = LogLevel.ERROR; break;
        case LoggerLevel.DEBUG: logLevel = LogLevel.DEBUG; break;
      }
      this.log.log(logLevel, message, parameters);
    };
    
    this.daikinApi = new DaikinApi(this.config.user!, this.config.password!, this.config.refreshInterval, logMessage);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    //Set first delay to -refreshInterval to immediately refresh
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, this.discover.bind(this, this.config.refreshInterval * -1)); 
  }

  private discover(delay = 0): void {
    this.log.debug('Executed didFinishLaunching callback');

    clearTimeout(this.discoverTimer);

    //If initialized, no need to try and discover devices again.
    if(this.daikinApi.isInitialized()){
      return;
    }

    const refresh = this.config.refreshInterval + delay;
    this.discoverTimer = setTimeout(()=>{
      void (async():Promise<void>=>{
        // run the method to discover / register your devices as accessories
        await this.discoverDevices();

        //Call discover again in case we failed to initialize the api and discover devices.
        this.discover();
      })();
    }, refresh * 1000);
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    if(!this.config.user && !this.config.password) {
      this.log.error('Credentials not set. Aborting discovery of devices.');
      return;
    }

    await this.daikinApi.Initialize();

    if(!this.daikinApi.isInitialized()){
      this.log.error('Unable to retrieve devices. Aborting discovery of devices.');
      return;
    }
    const devices = await this.daikinApi.getDeviceList() || [];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      this.log.info(`Found device: ${device.name}`);
      const deviceData = await this.daikinApi.getDeviceData(device.id);

      this.discoverThermostat(device);
      this.discoverOutdoorHumSensor(device);
      this.discoverIndoorHumSensor(device);
      this.discoverOutdoorAqi(device, deviceData);
      this.discoverIndoorAqi(device, deviceData);
      this.discoverAwaySwitch(device);
      this.discoverEmergencyHeatSwitch(device);
      this.discoverOneCleanFan(device);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverEmergencyHeatSwitch(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_emergency_heat`);
    this.log.info('Checking for Emergency Heat Switch...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableEmergencyHeatSwitch) {
      const dName = this.config.includeDeviceName ? `${device.name} Emergency Heat` : 'Emergency Heat';
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing emergency heat switch from cache:', existingAccessory.displayName);
        new DaikinOnePlusEmergencyHeatSwitch(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new emergency heat switch:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusEmergencyHeatSwitch(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Emergency Heat switch
      this.log.info('Removing emergency heat switch from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverOneCleanFan(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_one_clean_fan`);
    this.log.info('Checking for One Clean Fan...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableOneCleanFan) {
      const dName = this.config.includeDeviceName ? `${device.name} One Clean` : 'One Clean';
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing one clean fan from cache:', existingAccessory.displayName);
        new DaikinOnePlusOneCleanFan(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new one clean fan:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusOneCleanFan(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing one clean fan
      this.log.info('Removing one clean fan from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverAwaySwitch(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_away`);
    this.log.info('Checking for Away Switch...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (this.config.enableAwaySwitch) {
      const dName = this.config.includeDeviceName ? `${device.name} Away State` : 'Away State';
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing away switch from cache:', existingAccessory.displayName);
        new DaikinOnePlusAwaySwitch(this, existingAccessory, device.id, this.daikinApi, dName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new away switch:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusAwaySwitch(this, accessory, device.id, this.daikinApi, dName);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Away switch
      this.log.info('Removing Away switch from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverIndoorAqi(device: any, deviceData: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_iaqi`);
    this.log.info('Checking for indoor Air Quality sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if(!this.config.ignoreIndoorAqi){
      const dName = this.config.includeDeviceName ? `${device.name} Indoor AQI` : 'Indoor AQI';
      if (deviceData.aqIndoorAvailable) {
        if (existingAccessory) {
        // the accessory already exists
          existingAccessory.displayName = dName;
          existingAccessory.context.device = device;
          this.log.info('Restoring existing indoor Air Quality sensor from cache:', existingAccessory.displayName);
          new DaikinOnePlusAQSensor(this, existingAccessory, device.id, this.daikinApi, true, dName);
        } else {
        // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new indoor Air Quality sensor:', dName);

          const accessory = new this.api.platformAccessory(dName, uuid);
          accessory.context.device = device;
          new DaikinOnePlusAQSensor(this, accessory, device.id, this.daikinApi, true, dName);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      } else if (existingAccessory) {
        this.log.info('Removing legacy indoor Air Quality Sensor from cache:', existingAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    } else if (existingAccessory) {
      //Delete any existing Indoor AQI switch
      this.log.info('Removing Indoor AQI sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverOutdoorAqi(device: any, deviceData: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_oaqi`);
    this.log.info('Checking for outdoor Air Quality sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if(!this.config.ignoreOutdoorAqi){
      const dName = this.config.includeDeviceName ? `${device.name} Outdoor AQI` : 'Outdoor AQI';
      if (deviceData.aqOutdoorAvailable) {
        if (existingAccessory) {
        // the accessory already exists
          existingAccessory.displayName = dName;
          existingAccessory.context.device = device;
          this.log.info('Restoring existing outdoor Air Quality sensor from cache:', existingAccessory.displayName);
          new DaikinOnePlusAQSensor(this, existingAccessory, device.id, this.daikinApi, false, dName);
        } else {
        // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new outdoor Air Quality sensor:', dName);

          const accessory = new this.api.platformAccessory(dName, uuid);
          accessory.context.device = device;
          new DaikinOnePlusAQSensor(this, accessory, device.id, this.daikinApi, false, dName);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      } else if (existingAccessory) {
        this.log.info('Removing legacy outdoor Air Quality Sensor from cache:', existingAccessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      }
    } else if (existingAccessory) {
    //Delete any existing Outdoor AQI sensor
      this.log.info('Removing Outdoor AQI sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverIndoorHumSensor(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_ihum`);
    this.log.info('Checking for indoor humidity sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if(!this.config.ignoreIndoorHumSensor){
      const dName = this.config.includeDeviceName ? `${device.name} Indoor Humidity` : 'Indoor Humidity';
      if (existingAccessory) {
      // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing indoor humidity sensor from cache:', existingAccessory.displayName);
        new DaikinOnePlusHumidity(this, existingAccessory, device.id, this.daikinApi, true);
      } else {
      // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new indoor humidity sensor:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusHumidity(this, accessory, device.id, this.daikinApi, true);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
    //Delete any existing Indoor Humidity sensor
      this.log.info('Removing Indoor Humidity sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverOutdoorHumSensor(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_ohum`);
    this.log.info('Checking for outdoor humidity sensor...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if(!this.config.ignoreOutdoorHumSensor){
      const dName = this.config.includeDeviceName ? `${device.name} Outdoor Humidity` : 'Outdoor Humidity';
      if (existingAccessory) {
      // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing outdoor humidity sensor from cache:', existingAccessory.displayName);
        new DaikinOnePlusHumidity(this, existingAccessory, device.id, this.daikinApi, false);
      } else {
      // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new outdoor humidity sensor:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusHumidity(this, accessory, device.id, this.daikinApi, false);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
    //Delete any existing Outdoor Humidity sensor
      this.log.info('Removing Outdoor Humidity sensor from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private discoverThermostat(device: any) {
    const uuid = this.api.hap.uuid.generate(`${device.id}_tstat`);
    this.log.info('Checking for thermostat...');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (!this.config.ignoreThermostat) {
      const dName = this.config.includeDeviceName ? `${device.name} Thermostat` : 'Thermostat';
      if (existingAccessory) {
        // the accessory already exists
        existingAccessory.displayName = dName;
        existingAccessory.context.device = device;
        this.log.info('Restoring existing thermostat from cache:', existingAccessory.displayName);
        new DaikinOnePlusThermostat(this, existingAccessory, device.id, this.daikinApi);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new thermostat:', dName);

        const accessory = new this.api.platformAccessory(dName, uuid);
        accessory.context.device = device;
        new DaikinOnePlusThermostat(this, accessory, device.id, this.daikinApi);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    } else if (existingAccessory) {
      this.log.info('Removing Thermostat from cache:', existingAccessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }
  }
}
