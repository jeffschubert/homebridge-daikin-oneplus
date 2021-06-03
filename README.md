# Homebridge Daikin One+ Thermostat Plugin

Homebridge plugin to control a Daikin One+ Thermostat.

The plugin connects to the Daikin One+ API to retrieve all devices on your account and adds any thermostats found to Homebridge.

In addition to retrieving and setting the thermostat's current temperature, it will also retrieve the current relative humidity 
and allow you to set the desired humidity level.

## Homebridge Config

The easiest way to configure this plugin is via [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).

```javascript
"platforms": [
  {
    "platform": "DaikinOnePlus",
    "name": "Daikin One+",        // Required. The name of the thermostat.
    "user": "any@email.address",  // Required. The email of your Daikin One+ account.
    "password": "password",       // Required.
  }
]
```