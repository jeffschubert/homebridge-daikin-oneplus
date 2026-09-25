# Changelog

All notable changes to this project are documented here. Entries for 4.2.0
onward are written as changes land; earlier entries were reconstructed from the
version notes that used to live in the README and from the commit history
between release tags, so they summarize each release rather than list every
change — and dependency bumps, formatting and other housekeeping are left out.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 4.2.0 — 2026-09-24

### Added
- HTTP push history consumer: readings can be POSTed as JSON to any endpoint,
  either as each one is captured (the default) or batched on an interval.
  Configured via Push History to an HTTP Endpoint, Push URL, Push Token, Push
  Authentication (`Authorization: Bearer` / `X-Api-Key` / none), Push Body
  Format, Push Interval, Push Batch Size and Push Buffer Size.

### Changed
- Dependency refresh: eslint 10.11, prettier 3.9.8, `@eslint/js` 10, globals 17.

## 4.1.1 — 2026-09-10

### Added
- History files are gzip-compressed once their day has ended, to reduce disk
  usage. Enabled by default; configurable via Compress History Files.

## 4.1.0 — 2026-09-10

### Added
- Device data is routed to pluggable history consumers, including a history file
  consumer that writes daily JSONL files with a configurable path and retention.
- Raw Daikin API data can optionally be attached to each reading, filtered to a
  chosen set of fields.

### Fixed
- `schedOverride` is cleared when the Away switch is turned off with
  Auto Resume Schedule enabled.

## 4.0.0 — 2025-12-13

### Added
- System State switches, indicating the thermostat's current state.
- Device data logging.

### Changed
- Minimum Homebridge version increased to 1.8; minimum Node version increased to 18.
- Better support for multiple thermostats.
- HTTP calls use `fetch` instead of axios.

## 3.2.3 — 2025-11-03

### Fixed
- Reverted an overly restrictive Node compatibility range.

## 3.2.2 — 2025-10-29

### Added
- Homebridge v2 support.

## 3.2.1 — 2024-09-09

### Fixed
- The heating threshold is returned as the target temperature in Auto mode.
- Accessories are no longer discovered for known but offline devices, and AQI
  discovery handles missing device data.

## 3.2.0 — 2024-01-05

### Added
- Outdoor temperature sensor, with a config option to skip loading it.
- Debug logging option.

### Changed
- Both thresholds are set at once in Auto mode, and the schedule is refreshed
  after writes.
- Threshold step size and the allowable target temperature range were updated.

### Fixed
- Token expiration is no longer always computed as being in the past.

## 3.1.2 — 2022-12-17

### Fixed
- Automations could not change the temperature
  ([#28](https://github.com/jeffschubert/homebridge-daikin-oneplus/issues/28)).

## 3.1.1 — 2022-10-29

### Changed
- Reworked how the schedule resumes after the Away switch is toggled off.

## 3.1.0 — 2022-10-11

### Added
- Schedule switch accessory, to enable/disable the thermostat's schedule.

### Changed
- The Away accessory observes the Schedule switch and ignores `geoFencingEnabled`.

## 3.0.0 — 2022-06-25

### Changed
- Minimum Node version increased to 14, along with the supported Homebridge versions.
- Credentials use an `x-schema-form` in the Homebridge config UI.
- Plugin is now Homebridge-verified.

## 2.1.0 — 2022-06-05

### Added
- Circulate Air fan accessory.

### Changed
- More reliable accessory updates, consolidated PUT requests, and improved
  error handling and logging.

## 2.0.0 — 2021-12-27

### Changed
- The Daikin API is checked every 3 minutes, or on demand while interacting with
  HomeKit, instead of every 10 seconds.
- After an update, wait up to 15 seconds before checking the API so HomeKit
  doesn't show stale data.

## 1.0.0 — 2021-06-14

Initial release.
