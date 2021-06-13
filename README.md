# Homebridge Daikin One+ Thermostat Plugin

Homebridge plugin to control a Daikin One+ Thermostat.

The plugin connects to the Daikin One+ API to retrieve all devices on your account and adds any thermostats found to Homebridge.

In addition to retrieving and setting the thermostat's current temperature, it will also retrieve the current relative humidity 
and allow you to set the desired humidity level.

If your Daikin system reports such values, the plugin will also create separate Air Quality and Indoor/Outdoor Humidity sensors.

## Homebridge Config

The easiest way to configure this plugin is via [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x).

```javascript
"platforms": [
  {
    "platform": "DaikinOnePlus",
    "name": "Daikin One+",        // Required. The name of the thermostat. Can be anything.
    "user": "any@email.address",  // Required. The email of your Daikin One+ account.
    "password": "password",       // Required.
    "refreshInterval": 10,        // Required. The interval (in seconds) at which the plugin should get current values from the Daikin API.
    "includeDeviceName": false,   // Required. Should the default sensor names start with the thermostat name (as configured in the thermostat).
  }
]
```

## Acknowledgements
The Daikin API requests and parsing of the results is based on the [daikinskyport](https://github.com/apetrycki/daikinskyport) repo by apetrycki.