# Daikin One+ Thermostat Homebridge Plugin
[![Downloads](https://img.shields.io/npm/dt/homebridge-daikin-oneplus?logo=icloud&style=for-the-badge)](https://www.npmjs.com/package/homebridge-daikin-oneplus)
[![Version](https://img.shields.io/npm/v/homebridge-daikin-oneplus?label=Latest%20Version&style=for-the-badge)](https://www.npmjs.com/package/homebridge-daikin-oneplus)
[![Daikin One+@Homebridge Discord](https://img.shields.io/discord/432663330281226270?label=Discord&logo=discord&style=for-the-badge)](https://discord.gg/6whreuQEph)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

## HomeKit support for Daikin One+ thermostats using [Homebridge](https://homebridge.io)

`homebridge-daikin-oneplus` uses the Daikin One+ API to allow native HomeKit support via Homebridge for any thermostats on your account.

## Accessories and their features (dependant upon your system/equipment capabilities):
  * Thermostat
    * Display current temperature
    * Display and set target temperature
    * Switch mode between cool, heat, and auto
    * Set both cooling and heating threshold in auto mode
    * Temporarily override a schedule
      * Schedule will be paused for a period of time based on how the thermostat is configured. The thermostat can be configured to pause for 1, 4, or 8 hours, or until the next event in the schedule.
    * Air Quality sensors
      * Display indoor and outdoor levels
    * Relative humidity sensors
      * Display indoor and outdoor levels
      * Set target indoor relative humidity
  * Schedule switch
    * Display and set thermostat's schedule state
  * Away switch
    * Display and set thermostat's away state
    * Optionally, the schedule can be enabled automatically when the Away switch is toggled off. By default this plugin and the thermostat itself do not enable the schedule after returning from Away.
  * Emergency Heat switch
    * Display and set thermostat's emergency/auxiliary heat state
  * One Clean fan
    * Trigger the thermostat to run the fan for a 3 hour One Clean cycle
  * Circulate Air fan
    * Allows the Circulate Air feature to be toggled between 'off' and 'always on'
    * Fan speed can be adjusted:
      * 0% : Off
      * 33% : Low
      * 66% : Medium
      * 100% : High
  * Version 2+ improves performance in several ways:
    * Reduce bandwidth by checking the Daikin API every 3 minutes or on demand when interacting with HomeKit (instead of the previous every 10s)
    * After updates, wait up to 15 seconds before checking API to avoid HomeKit showing stale data.
  * Version 3 
    * Minimum node version increased to 14
    * Plugin is now verified!


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

If you have installed the [Homebridge Config UI](https://github.com/oznu/homebridge-config-ui-x), you can install this plugin by going to the `Plugins` tab and searching for `homebridge-daikin-oneplus` and installing it.

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
    "ignoreOutdoorTemp": false,         // If true, do not load outdoor temperature data of thermostats found in Daiking account.
    "enableAwaySwitch": false,          // If true, enable switch accessory to get/set the Away state of thermostats found in Daikin account.
    "autoResumeSchedule": false,        // If true, enable schedule after Away switch is toggled off.
    "enableEmergencyHeatSwitch": false, // If true, enable switch accessory to request auxiliary/emergency heat only.
    "enableOneCleanFan": false,         // If true, enable fan accessory that allows the user to run one clean.
    "enableCirculateAirFan": false,     // If true, enable fan accessory that allows the user to run the fan constantly at the specified speed.
    "enableScheduleSwitch": false,      // If true, enable switch accessory to get/set the Schedule state of thermostats found in Daikin account.
  }
]
```

## Acknowledgements
The Daikin API requests and parsing of the results is based on the [daikinskyport](https://github.com/apetrycki/daikinskyport) repo by apetrycki.

Many thanks to [Fabian Frank](https://github.com/FabianFrank) for his valued contributions towards performance improvements and other bug fixes.
