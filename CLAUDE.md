# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Homebridge dynamic platform plugin (`homebridge-daikin-oneplus`) that talks to the undocumented Daikin Skyport API (`api.daikinskyport.com`, the same API used by the Daikin One Home app) and exposes Daikin One+ thermostats to HomeKit. ESM TypeScript, compiled to `dist/` for Homebridge to load.

## Commands

```bash
npm run build          # rimraf dist + tsc
npm run lint            # eslint src/**.ts --max-warnings=0
npm run format          # prettier --write src
npm run format:check    # prettier --check src
npm run verify           # format:check + lint + build — run this before considering a change done
```

`npm test` builds and runs the `node:test` suites in `test/` (synthetic data, no Daikin requests). Verification is verify + test + manual exercise against a real thermostat.

To run against a live Homebridge instance during development, use `./dev.sh` (gitignored helper): it runs `npm run verify`, restarts the `hb-service` Homebridge instance, and tails logs. It assumes the plugin is already `npm link`ed into Homebridge's global `node_modules`. Alternatively `npm run debug` (`prepublishOnly` + `npm link` + `homebridge -D`).

## Architecture

**`DaikinApi` (`src/daikinapi.ts`)** is the single source of truth for device state. It owns a per-thermostat data cache (`_devices`), change listeners, history recording, and an internal polling/backoff loop whose intervals come from the transport's `timing`: `foregroundRefreshMs` while a HomeKit controller is actively interacting, `backgroundRefreshMs` otherwise, and a `writeDelayMs` hold-off after writes. Accessory classes never call Daikin endpoints directly — they read cached device data and register change listeners via `DaikinApi`.

**Transports** — `DaikinApi` does all device I/O through a `DaikinTransport` (`src/daikinTransport.ts`): `initialize`, `listDevices`, `fetchData`, `write`, plus `timing`. A transport translates its wire format to/from `ThermostatData`/`ThermostatUpdate`, so nothing above it is transport-specific. `CloudTransport` (`src/cloudTransport.ts`) talks to the Skyport cloud API and owns auth (login + token refresh); its timing is 10s foreground / 180s background / 15s write delay, because the cloud echoes stale data for a few seconds post-write. `LocalTransport` (`src/localTransport.ts`) talks to each thermostat's Daikin One Local API over plain HTTP (no auth, form-encoded POSTs, 5s/60s/2s timing) and supports only a subset of features. Thermostats come from `localDevices` and, when `localDiscovery` is on, from a one-shot mDNS browse at startup (`src/localDiscovery.ts`, using `bonjour-service`; services are `_http._tcp` with `api_ver`/`mac`/`model` TXT fields). Discovered devices get the ID `local-<mac>`; when a device with a known MAC stops responding, it's looked up again by MAC (at most once a minute) to follow an IP change. Each transport declares `capabilities`; the platform skips or removes accessories, and accessories drop characteristics, for unsupported features. `connectionMode` (`cloud` default, or `local`) selects the transport.

**Device identity** — accessory UUIDs and `DaikinApi`'s device keys are a stable ID, not necessarily the transport's own ID. On discovery, `resolveDeviceIds` (`src/deviceIdentity.ts`) matches transport devices to devices already stored in cached accessories' `context.device`: exact ID first, then a unique name + model match. `DaikinApi` maps the stable ID back to the transport ID for I/O. This is what lets users switch between cloud and local without losing HomeKit accessories.

**`DaikinOnePlusPlatform` (`src/platform.ts`)** is the Homebridge entry point (`DynamicPlatformPlugin`). It parses/normalizes config into `DaikinOptions` (see `src/types.ts`), constructs one shared `DaikinApi` and one shared `HistoryStore`, and on `DID_FINISH_LAUNCHING` discovers Daikin devices and creates/restores/removes one Homebridge accessory per feature per thermostat (thermostat, AQI sensors, humidity sensors, outdoor temp, away/schedule/emergency-heat switches, state switches, One Clean/Circulate Air fans). Each `discoverX` method follows the same pattern: compute a stable UUID from `${device.id}_<suffix>`, look for a cached accessory with that UUID, and either restore/update it or unregister it depending on whether the corresponding config flag is enabled. All accessory classes live in `src/platform*.ts` (one file per accessory type) and take `(platform, accessory, deviceId, daikinApi)` in their constructor, wiring HomeKit characteristic get/set handlers to `DaikinApi` calls.

**History pipeline** — a fan-out from a single normalized event to independently pluggable sinks:
- `HistoryStore` (`src/historyStore.ts`) is fed every reading via `record(deviceId, data, setPoint)` from `DaikinApi`. It normalizes raw `ThermostatData` into a device-shape-agnostic `ThermostatReading` (see `src/types.ts`) and fans it out to every registered `HistoryConsumer`. It has no storage opinion of its own — that lives entirely in consumers. `recordRawData`/`rawDataFields` config controls whether/which raw API fields get attached to `allData`.
- `HistoryConsumer` (interface in `src/types.ts`) is the extension point: `onReading` (required), plus optional `onAccessoryRegistered` (for consumers that need to attach to a specific accessory) and `destroy` (cleanup on shutdown). Implementations must be idempotent w.r.t. `onAccessoryRegistered` since it can be called more than once per device across cache restores.
- Current consumer, registered in `HistoryStore.initConsumers()` based on config flags: `JsonlFileHistoryConsumer` (`enableHistory` — writes daily JSONL files under `storagePath`/`retentionDays`, gzip-compressing completed days when `compressHistoryFiles` is set). Add new sinks (Eve/fakegato, MQTT, InfluxDB, ...) by implementing `HistoryConsumer` and registering it in `initConsumers()` — no changes needed elsewhere. (An Eve-app history consumer built on `fakegato-history` is in progress on a feature branch, not yet on `master`.)

**Config** (`config.schema.json` + `DaikinOptions` in `src/types.ts`) must be kept in sync when adding a new plugin setting — the schema drives the Homebridge Config UI form, and `DaikinOptions`/`DaikinOnePlusPlatform`'s constructor is where raw `PlatformConfig` values get validated/defaulted into typed config.

## Conventions

- ESM throughout — relative imports must use `.js` extensions (even though source is `.ts`), per `nodenext` module resolution.
- ESLint enforces explicit member accessibility (`public`/`private`) on all class members, no floating/misused promises, `await`-only over `.then()`, and no unused vars (prefix intentionally-unused args with `_`).
- New/changed accessory or consumer classes should follow the existing constructor shape (`platform`, `accessory`, `deviceId`, `daikinApi`, ...) and file-per-accessory-type layout under `src/`.
- Keep comments pithy: state what the code does only where it isn't obvious. Don't narrate history (past versions, why something used to be different) in code comments — that belongs in commit messages/PRs, not the source.

## Git

- Every git write command (commit, push, branch, etc.) requires confirmation each time — approval given for one does not carry over to the next. Never chain a write command onto a prior approval.
- Never rebase. Use merge to integrate changes.
