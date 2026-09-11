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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class FakeGatoHistoryService {
    public constructor(
      accessoryType: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      accessory: PlatformAccessory<any>,
      options?: FakeGatoHistoryOptions | number,
    );
    public addEntry(entry: HistoryEntry): void;
    public getInitialTime(): number;
    public isHistoryLoaded(): boolean;
  }

  function fakegato(api: API): typeof FakeGatoHistoryService;

  export default fakegato;
}
