# Homebridge Daikin One+ Thermostat Plugin

Homebridge plugin to control a Daikin One+ Thermostat.

The plugin connects to the Daikin One+ API to retrieve all devices on your account and adds any thermostats found to Homebridge.

In addition to basic retrieving and setting of the thermostat's current temperature, it has the following features:
  * Display indoor and outdoor air quality level *
  * Display indoor and outdoor relative humidity *
  * Set target indoor relative humidity *
  * Away switch to get/set away state of thermostat
  * Emergency Heat switch to get/set emergency/auxiliary heat state of thermostat (v2)
  * One Clean fan to trigger the thermostat to run the fan for a 3 hour One Clean cycle (v2)
  * Circulate Air fan (v2.1)
    * Allows the Circulate Air feature to be toggled between 'off' and 'always on'
    * Fan speed can be adjusted:
      * 0% : Off
      * 33% : Low
      * 66% : Medium
      * 100% : High
  * Advanced thermostat functionality
    * Switch between cool, heat, and auto
    * In Auto, set both cooling and heating threshold
    * Temporarily override a schedule.
      * Schedule will be paused for a period of time based on how the thermostat is configured. The thermostat can be configured to pause for 1, 4, or 8 hours, or until the next event in the schedule.
  * Additionally, version 2 improves performance in several ways:
    * Reduce bandwidth by checking the Daikin API every 3 minutes or on demand when interacting with HomeKit (instead of the previous every 10s)
    * After updates, wait up to 15 seconds before checking API to avoid HomeKit showing stale data.


\* If supported by your Daikin system.

## Known Issue
  * Per [issue #20](https://github.com/jeffschubert/homebridge-daikin-oneplus/issues/20), it may now be necessary to request an integration token via the Daikin One Home app before this plugin can successfully communicate with the Daikin API.
    * To get an integration token:
      * Open the Daikin One Home app
      * Go to **account settings** on the Location/root/top screen of the app.
      * Select **home integration**
      * Select **get integration token**
      * Agree to terms
      * Enter your account password
      * Select **send request**
    * Once you receive the token, nothing further should be required.
    * You may need to uninstall/reinstall the plugin, or at least restart Homebridge to get a successful connection.

## Installation
If you are new to Homebridge, please first read the [Homebridge](https://homebridge.io) [documentation](https://github.com/homebridge/homebridge/wiki) and installation instructions before proceeding.

If you have installed the [Homebridge Config UI](https://github.com/oznu/homebridge-config-ui-x), you can intall this plugin by going to the `Plugins` tab and searching for `homebridge-daikin-oneplus` and installing it.

If you prefer to install `homebridge-daikin-oneplus` from the command line, you can do so by executing:

```sh
sudo npm install -g homebridge-daikin-oneplus
```

## Homebridge Config

The easiest way to configure this plugin is via [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).

```javascript
"platforms": [
  {
    "platform": "DaikinOnePlus",
    "name": "Daikin One+",              // Required. The name of the thermostat. Can be anything.
    "user": "any@email.address",        // Required. The email of your Daikin One+ account.
    "password": "password",             // Required.
    "includeDeviceName": false,         // Required. Should the default sensor names start with the thermostat name (as configured in the thermostat).
    "ignoreThermostat": false,          // If true, do not load thermostats found in Daikin account.
    "ignoreIndoorAqi": false,           // If true, do not load indoor air quality sensors of thermostats found in Daikin account.
    "ignoreOutdoorAqi": false,          // If true, do not load outdoor air quality sensors of thermostats found in Daikin account.
    "ignoreIndoorHumSensor": false,     // If true, do not load indoor humidity sensors of thermostats found in Daikin account.
    "ignoreOutdoorHumSensor": false,    // If true, do not load outdoor humidity sensors of thermostats found in Daikin account.
    "enableAwaySwitch": false,          // If true, enable switch accessory to get/set the Away state of thermostats found in Daikin account.
    "enableEmergencyHeatSwitch": false, // If true, enable switch accessory to request auxiliary/emergency heat only.
    "enableOneCleanFan": false,         // If true, enable fan accessory that allows the user to run one clean.
    "enableCirculateAirFan": false,     // If true, enable fan accessory that allows the user to run the fan constantly at the specified speed.
  }
]
```

## Acknowledgements
The Daikin API requests and parsing of the results is based on the [daikinskyport](https://github.com/apetrycki/daikinskyport) repo by apetrycki.

Many thanks to [Fabian Frank](https://github.com/FabianFrank) for his valued contributions towards performance improvements and other bug fixes.