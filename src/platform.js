"use strict";
exports.__esModule = true;
exports.DaikinOnePlusPlatform = void 0;
var settings_1 = require("./settings");
var platformAccessory_1 = require("./platformAccessory");
var daikinapi_1 = require("./daikinapi");
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
var DaikinOnePlusPlatform = /** @class */ (function () {
    function DaikinOnePlusPlatform(log, config, api) {
        var _this = this;
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        // this is used to track restored cached accessories
        this.accessories = [];
        this.log.debug('Finished initializing platform:', this.config.name);
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', function () {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            _this.discoverDevices();
        });
    }
    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    DaikinOnePlusPlatform.prototype.configureAccessory = function (accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    };
    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    DaikinOnePlusPlatform.prototype.discoverDevices = function () {
        // EXAMPLE ONLY
        // A real plugin you would discover accessories from the local network, cloud services
        // or a user-defined array in the platform config.
        var exampleDevices = [
            {
                exampleUniqueId: 'ABCD',
                exampleDisplayName: 'Bedroom'
            },
            {
                exampleUniqueId: 'EFGH',
                exampleDisplayName: 'Kitchen'
            },
        ];
        var api = new daikinapi_1.DaikinApi('daikin@jhfamily.net', 'yHC7CX$9TP6A');
        var _loop_1 = function (device) {
            // generate a unique id for the accessory this should be generated from
            // something globally unique, but constant, for example, the device serial
            // number or MAC address
            var uuid = this_1.api.hap.uuid.generate(device.exampleUniqueId);
            // see if an accessory with the same uuid has already been registered and restored from
            // the cached devices we stored in the `configureAccessory` method above
            var existingAccessory = this_1.accessories.find(function (accessory) { return accessory.UUID === uuid; });
            if (existingAccessory) {
                // the accessory already exists
                this_1.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
                // existingAccessory.context.device = device;
                // this.api.updatePlatformAccessories([existingAccessory]);
                // create the accessory handler for the restored accessory
                // this is imported from `platformAccessory.ts`
                new platformAccessory_1.DaikinOnePlusAccessory(this_1, existingAccessory);
            }
            else {
                // the accessory does not yet exist, so we need to create it
                this_1.log.info('Adding new accessory:', device.exampleDisplayName);
                // create a new accessory
                var accessory = new this_1.api.platformAccessory(device.exampleDisplayName, uuid);
                // store a copy of the device object in the `accessory.context`
                // the `context` property can be used to store any data about the accessory you may need
                accessory.context.device = device;
                // create the accessory handler for the newly create accessory
                // this is imported from `platformAccessory.ts`
                new platformAccessory_1.DaikinOnePlusAccessory(this_1, accessory);
                // link the accessory to your platform
                this_1.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
            }
        };
        var this_1 = this;
        // loop over the discovered devices and register each one if it has not already been registered
        for (var _i = 0, exampleDevices_1 = exampleDevices; _i < exampleDevices_1.length; _i++) {
            var device = exampleDevices_1[_i];
            _loop_1(device);
        }
    };
    return DaikinOnePlusPlatform;
}());
exports.DaikinOnePlusPlatform = DaikinOnePlusPlatform;
