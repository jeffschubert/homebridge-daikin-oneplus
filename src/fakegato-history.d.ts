declare module 'fakegato-history' {
  import { API, Logging, PlatformAccessory } from 'homebridge';

  interface FakeGatoHistoryOptions {
    size?: number;
    storage?: 'fs' | 'googleDrive';
    path?: string;
    folder?: string;
    keyPath?: string;
    disableTimer?: boolean;
    disableRepeatLastData?: boolean;
    log?: Logging;
  }

  interface HistoryEntry {
    time: number;
    currentTemp?: number;
    setTemp?: number;
    valvePosition?: number;
    temp?: number;
    humidity?: number;
    ppm?: number;
    pressure?: number;
    power?: number;
    status?: number;
    voc?: number;
    lux?: number;
  }

  class FakeGatoHistoryService {
    constructor(
      accessoryType: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      accessory: PlatformAccessory<any>,
      options?: FakeGatoHistoryOptions | number,
    );
    addEntry(entry: HistoryEntry): void;
    getInitialTime(): number;
    isHistoryLoaded(): boolean;
  }

  function fakegato(api: API): typeof FakeGatoHistoryService;

  export default fakegato;
}
