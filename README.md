# Daikin One+ Thermostat Homebridge Plugin
[![Downloads](https://img.shields.io/npm/dt/homebridge-daikin-oneplus?logo=icloud&style=for-the-badge)](https://www.npmjs.com/package/homebridge-daikin-oneplus)
[![Version](https://img.shields.io/npm/v/homebridge-daikin-oneplus?label=Latest%20Version&style=for-the-badge)](https://www.npmjs.com/package/homebridge-daikin-oneplus)
[![Daikin One+@Homebridge Discord](https://img.shields.io/discord/432663330281226270?label=Discord&logo=discord&style=for-the-badge)](https://discord.gg/6whreuQEph)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

## HomeKit support for Daikin One+ thermostats using [Homebridge](https://homebridge.io)

`homebridge-daikin-oneplus` uses the Daikin One+ API to allow native HomeKit support via Homebridge for any thermostats on your account.
> This plugin has been reported to work with Amana Home Wifi thermostats. No guarantees, but if it works with yours, drop a note in [this discussion](https://github.com/jeffschubert/homebridge-daikin-oneplus/discussions/52). 
## Accessories and their features (dependent upon your system/equipment capabilities):
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
  * System State switches
    * Read-only switches for each possible thermostat state (heating, cooling, fan, idle, and overcool/dehumidify).
    * Switch will display as On when the thermostat is in the respective state and as Off otherwise.
    * Useful for triggering Home automations when the system starts or stops the pertinent state(s).
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

## Release Notes
See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

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
    "name": "Daikin One Plus",          // Required. The name of the thermostat. Can be anything.
    "connectionMode": "cloud",          // 'cloud' (default) or 'local'. See "Cloud or Local mode" below.
    "user": "any@email.address",        // Required in cloud mode. The email of your Daikin One+ account.
    "password": "password",             // Required in cloud mode.
    "localDiscovery": true,             // Local mode: find thermostats on the network automatically (default true).
    "localDevices": [                   // Local mode: thermostats to add by address. Required if localDiscovery is false.
      { "host": "192.168.1.52", "port": 80, "deviceId": "" }  // port defaults to 80; deviceId is optional (see below).
    ],
    "includeDeviceName": false,         // Required. Should the default sensor names start with the thermostat name (as configured in the thermostat).
    "ignoreThermostat": false,          // If true, do not load thermostats found in Daikin account.
    "ignoreIndoorAqi": false,           // If true, do not load indoor air quality sensors of thermostats found in Daikin account.
    "ignoreOutdoorAqi": false,          // If true, do not load outdoor air quality sensors of thermostats found in Daikin account.
    "ignoreIndoorHumSensor": false,     // If true, do not load indoor humidity sensors of thermostats found in Daikin account.
    "ignoreOutdoorHumSensor": false,    // If true, do not load outdoor humidity sensors of thermostats found in Daikin account.
    "ignoreOutdoorTemp": false,         // If true, do not load outdoor temperature data of thermostats found in Daiking account.
    "enableAwaySwitch": false,          // If true, enable switch accessory to get/set the Away state of thermostats found in Daikin account.
    "enableStateSwitches": false,         // If true, enable switch accessories that indicate the current running state of thermostats found in Daikin account.
    "autoResumeSchedule": false,        // If true, enable schedule after Away switch is toggled off.
    "enableEmergencyHeatSwitch": false, // If true, enable switch accessory to request auxiliary/emergency heat only.
    "enableOneCleanFan": false,         // If true, enable fan accessory that allows the user to run one clean.
    "enableCirculateAirFan": false,     // If true, enable fan accessory that allows the user to run the fan constantly at the specified speed.
    "enableScheduleSwitch": false,      // If true, enable switch accessory to get/set the Schedule state of thermostats found in Daikin account.
    "debug": false,                     // If true, enables debug level logging.
    "logRaw": false,                    // If true, enables logging of raw device data from Daikin API. \'debug\' must also be set to true.
    "enableHistoryPush": false,         // If true, POST each reading to the HTTP endpoint below.
    "pushUrl": "",                      // Full URL readings are posted to, e.g. http://my-collector.local:8080/api/readings.
    "pushToken": "",                    // Token sent with each request. Leave empty if the endpoint needs no authentication.
    "pushAuthScheme": "bearer",         // How the token is sent: 'bearer' (Authorization: Bearer), 'apiKey' (X-Api-Key), or 'none'.
    "pushBodyFormat": "readings",       // Body shape: 'readings' for { "readings": [...] }, or 'array' for a bare array.
    "pushIntervalSeconds": 0,           // How often buffered readings are posted. 0 posts each reading as soon as it's captured.
    "pushBatchSize": 100,               // Maximum readings per request.
    "pushMaxBuffer": 200,               // Maximum unsent readings held in memory while the endpoint is unreachable.
  }
]
```

### Cloud or Local mode

By default the plugin uses the Daikin cloud API through your Daikin account,
which supports every accessory and feature above.

Local mode talks to each thermostat directly on your network using the
[Daikin One Local API](https://www.daikinac.com/dakin-one-local-api), so it
keeps working without the Daikin cloud. To use it:

1. Update the thermostat to the latest firmware, then turn on **Settings >
   Wi-Fi > Local API** on the thermostat itself (it can't be turned on from
   the app).
2. Set `connectionMode` to `local`.

The plugin finds thermostats on your network automatically using mDNS, and
follows a thermostat if its IP address changes. If discovery doesn't work on
your network, for example because Homebridge runs in Docker without host
networking, turn off `localDiscovery` and list each thermostat's address in
`localDevices` instead, giving it a fixed IP address (a DHCP reservation).
Listed thermostats and discovered ones can be combined; a thermostat found both
ways is only added once.

The Local API supports less than the cloud API. In local mode you get mode,
heating/cooling setpoints, display units, indoor temperature and humidity, the
System State switches, the Emergency Heat switch (where the system supports
it) and the Circulate Air fan as on/off only. Outdoor temperature and humidity,
air quality, the Schedule and Away switches, One Clean, fan speed and target
humidity aren't available, and those accessories are removed in local mode.

Your Daikin login and local thermostat list can both stay in the config, so
switching modes only means changing `connectionMode`; the other mode's settings
are ignored. Switching also keeps your existing accessories, along with their
rooms, scenes and automations. The plugin matches each thermostat to its
existing accessories by the thermostat's name. If two thermostats share a
name, list each one in `localDevices` with its `deviceId` set to the Serial
Number shown for that thermostat's existing accessories. Accessories removed in local mode come
back as new accessories when you switch back to cloud mode.

The Local API has no authentication, so anything on your network can control
the thermostat once it's turned on.

### Pushing history to an HTTP endpoint

Alongside (or instead of) the daily JSONL history files, readings can be POSTed
as JSON to any endpoint. By default each reading is posted as soon as it's
captured; set `pushIntervalSeconds` above 0 to batch them instead. A failed
request keeps its readings buffered and retries, so a restart of the receiver
doesn't lose data. Only the newest `pushMaxBuffer` readings are kept while the
endpoint is unreachable — with raw data attached a reading can be ~50KB, so the
default of 200 caps this at roughly 10MB, and the history files remain the
durable record.

Each reading is posted in the same shape as a line of the JSONL history files.
Because a partially-delivered batch is re-sent whole, the receiving endpoint
should ignore readings it has already stored.

## Acknowledgements
The Daikin API requests and parsing of the results is based on the [daikinskyport](https://github.com/apetrycki/daikinskyport) repo by apetrycki.

Many thanks to [Fabian Frank](https://github.com/FabianFrank) for his valued contributions throughout the project.

## Multiple thermostats and HVAC zones

Every physical thermostat is polled once per cycle. Each enabled zone becomes a separate HomeKit thermostat with its own current temperature, relative humidity, operating state, mode, and active heating/cooling thresholds. Discovery accepts `ZoneNEnable: 1` for any zone number; `0`, `255`, missing enable fields, and `ZoneInt` placeholders do not create additional zones. Devices without zone metadata retain the original single-thermostat behavior and naming.

For a device named **Main Room**, `Zone1Name: "Zone1"` produces **Main Room**, and `Zone2Name: "Upstairs"` produces **Upstairs**. Custom zone names are used directly; unnamed/generic additional zones use the device name plus zone number. Device names and zone names never determine accessory identity. Zone 1 keeps its existing UUID, preserving HomeKit room assignments and automations. Renaming may require updating a name previously customized in the Home app. Multiple physical thermostats and third/later zones have distinct stable identities even when their names match.

Zone 1 reads unprefixed operational fields; later zones read `ZoneN` fields. Missing, invalid, disabled, and `255` readings produce HomeKit communication errors rather than main-zone fallbacks. Successful polls replace the readings, so missing values do not survive from an older response. Readings expire after ten minutes without a successful recognized response; errors are pushed on subsequent polls and returned immediately on HomeKit reads. Explicitly disabled zones are removed; missing metadata or API failures retain cached accessories. Retained additional zones with missing enable metadata report unavailable until it returns. Zone changes are discovered during normal polling; newly added physical thermostats require a Homebridge restart.

Zones are cloud-only. The local API reports only the main zone, so in local mode additional-zone accessories are kept but report unavailable until you switch back to cloud.

### Experimental controls: opt in only after planning hardware validation

Additional zones are **display-only by default**. Keep this platform setting omitted or false for read-only validation:

```json
"enableAdditionalZoneControls": false
```

Attempting to control an additional zone returns a HomeKit communication error, logs the reason, and sends no PUT. The existing primary-zone controls remain enabled. Disable automations that could issue primary-zone writes during a read-only validation session.

Setting `enableAdditionalZoneControls` to `true` opts in to **unverified** additional-zone temperature and mode writes. This is a platform-wide setting, applying to all additional zones on all physical thermostats. The proposed mapping sends `ZoneNhspHome`, `ZoneNcspHome`, `ZoneNmode`, and, when that zone's schedule is enabled, `ZoneNschedOverride: 1` to the physical device's `/deviceData/{deviceId}` endpoint. Zone 1 continues using unprefixed writable Home fields. Active fields are display values and are never sent in PUTs. `CurrentViewedZone` is never changed.

In Auto mode, editing one threshold immediately sends both Home setpoints, retaining the other current active threshold. Same-zone edits serialize; separate zones maintain separate queues and cache fields. Invalid/crossed thresholds or unavailable counterpart/schedule data fail without a PUT. Failed requests leave the cache unchanged. Successful requests update the cache optimistically, then the next poll reconciles with hardware after the existing 15-second write delay. Foreground/background polling remains 10/180 seconds. An optimistic HomeKit value or HTTP success is **not** proof of independent zone control.

Verified on the supplied ONEPLUS firmware 4.1.6 example: zone discovery and additional-zone readings use the `ZoneN` schema, with Celsius temperatures. Additional-zone writes, merged-zone behavior, zone-specific constraints/deadbands, and support on other firmware/hardware remain unverified. The plugin does not claim that a zone merged with Zone 1 can be controlled independently.

### Shared equipment and history

Outdoor temperature/humidity, indoor/outdoor AQI, One Clean, Circulate Air, and emergency heat remain one set per physical thermostat. Existing schedule, away, state switches, and target-humidity controls retain their main-zone mappings. Additional-zone schedule/away switches, fans, emergency heat, and humidification controls are deferred until their capabilities and write semantics are verified. Each zone thermostat does expose its own current humidity and operating state. Display units are shared: additional thermostats display the physical thermostat's units, but attempts to change them there return an error; change units through the main thermostat.

History/export keeps the existing main-zone record format. Additional-zone records retain the physical `deviceId` and add `zoneNumber` and `zoneName`, with normalized readings from that zone only. Consumers must group additional readings by `(deviceId, zoneNumber)`; absent `zoneNumber` means the legacy main record. Outdoor readings are not duplicated in additional-zone records. Optional raw fields in additional-zone records use operational names with the zone prefix removed; raw field filters should use those names.

### Install this modified checkout into an existing Homebridge setup

Back up your Homebridge configuration and cached accessories, and record the currently installed plugin version for rollback. Do not remove HomeKit accessories or reset the Homebridge cache. Use a supported Node version (see `package.json`) and run in this checkout:

```sh
npm ci
npm run verify
npm test
npm pack
```

Install the resulting `homebridge-daikin-oneplus-4.2.0.tgz` on the Homebridge host, using the npm installation directory and service account used by that Homebridge instance. For a conventional global npm installation:

```sh
npm install -g /absolute/path/homebridge-daikin-oneplus-4.2.0.tgz
```

An administrator may need to run that install. Homebridge UI/Docker installations can have a different plugin directory: install into that instance's existing plugin directory rather than a second, unrelated global npm prefix. Keep the existing `DaikinOnePlus` platform, credentials, and settings; add `"enableAdditionalZoneControls": false`. Restart Homebridge using its normal service/UI controls. This build retains version 4.2.0, so an upstream plugin reinstall/update can replace the local modifications. The tarball includes compiled `dist` files; no npm publication is required. To roll back, reinstall the recorded upstream version in the same location and restart Homebridge.

### Staged hardware validation

1. **Read-only first.** Leave additional-zone controls false. Compare Main Room and Upstairs current temperature, humidity, mode, equipment status, and active thresholds with the Daikin app and physical thermostat across several polls. Confirm the existing primary accessory retains its room and automations, and that outdoor/system features are not duplicated. Restart Homebridge and confirm the same accessories return without duplicates. Review synthetic tests with `npm test`; they make no Daikin requests.
2. **Obtain explicit authorization before live changes.** Record the exact physical device, zone number/name, property, current value, requested value, allowed mode/schedule changes, observation window, and restoration value. Obtain the owner's authorization for that exact test. Enabling the setting alone does not authorize live HVAC testing by a developer or agent.
3. **One authorized change.** After authorization, enable additional-zone controls and restart Homebridge. Change only the approved zone/property. Wait at least 15 seconds, then allow a fresh poll (open the thermostat in HomeKit to request foreground polling). Confirm subsequent API readings and the Daikin app show the intended zone's writable/active settings changed as expected, including schedule override behavior. Compare every other zone before/after to confirm isolation. Do not rely on the immediate optimistic display or an HTTP 2xx response.
4. **Extend only with authorization.** Separately authorize and test heating, cooling, single-threshold Auto edits in each direction, mode, schedule-enabled/disabled behavior, and finally concurrent-zone edits. Respect hardware constraints and merged zones. Restore the authorized original settings, confirm them through later readings and the app, disable the experimental setting, and restart. Keep the feature experimental until these observations establish independent controls on the specific hardware/firmware.
