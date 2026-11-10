import { Logging } from 'homebridge';
import { Thermostat, ThermostatData, ThermostatUpdate } from './types.js';
import { DaikinTransport, TransportTiming, logError } from './daikinTransport.js';

/**
 * Token response from the Daikin authentication API.
 */
interface DaikinTokenResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

const CLOUD_TIMING: TransportTiming = {
  // After a write the cloud API returns old data for up to 15 seconds.
  // https://daikinone.com/openapi/documentation/
  writeDelayMs: 15 * 1000,
  foregroundRefreshMs: 10 * 1000,
  backgroundRefreshMs: 180 * 1000,
};

const DAIKIN_API_LOGIN_URL = 'https://api.daikinskyport.com/users/auth/login';

const DAIKIN_API_DEVICES_URL = 'https://api.daikinskyport.com/devices';

const DAIKIN_API_TOKEN_URL = 'https://api.daikinskyport.com/users/auth/token';

const getDeviceUrl = (deviceId: string) => {
  return `https://api.daikinskyport.com/deviceData/${deviceId}`;
};

/**
 * Transport for the Daikin Skyport cloud API (api.daikinskyport.com), the same API used by the
 * Daikin One Home app.
 */
export class CloudTransport implements DaikinTransport {
  public readonly timing = CLOUD_TIMING;

  private _token: DaikinTokenResponse | undefined;
  private _tokenExpiration = new Date(0);

  public constructor(
    private readonly user: string,
    private readonly password: string,
    private readonly log: Logging,
  ) {}

  public async initialize(): Promise<boolean> {
    await this.getToken();
    if (!this._token) {
      this.log.error('Unable to retrieve token.');
      return false;
    }
    return true;
  }

  public async listDevices(): Promise<Thermostat[]> {
    return (await this.getRequest(DAIKIN_API_DEVICES_URL)) ?? [];
  }

  public async fetchData(deviceId: string): Promise<ThermostatData | undefined> {
    return await this.getRequest(getDeviceUrl(deviceId));
  }

  public async write(deviceId: string, update: ThermostatUpdate): Promise<boolean> {
    if (!this._token) {
      this.log.error('No token for write request: %s', deviceId);
      return false;
    }

    const uri = getDeviceUrl(deviceId);
    const response = await fetch(uri, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._token.accessToken}`,
      },
      body: JSON.stringify(update),
    });

    if (!response.ok) {
      logError(this.log, `Request ${uri} failed with status ${response.status} - ${response.statusText}.`, await response.text());
      return false;
    }

    this.log.debug('device: %s; response: %s', deviceId, JSON.stringify(response.json()));
    return true;
  }

  private async getToken() {
    this.log.debug('Getting token...');
    try {
      const response = await fetch(DAIKIN_API_LOGIN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.user,
          password: this.password,
        }),
      });

      if (!response.ok) {
        logError(
          this.log,
          `Request ${DAIKIN_API_LOGIN_URL} failed with status ${response.status} - ${response.statusText}.`,
          await response.text(),
        );
        return;
      }

      const token: DaikinTokenResponse = await response.json();
      this.setToken(token);
    } catch (error) {
      logError(this.log, 'Error getting token:', error);
    }
  }

  private setToken(token: DaikinTokenResponse) {
    this._token = token;
    this._tokenExpiration = new Date();

    const expSeconds = this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn - (this.timing.backgroundRefreshMs / 1000) * 2;

    //Set expiration a little early.
    this._tokenExpiration.setSeconds(expSeconds);
  }

  private async refreshToken() {
    if (typeof this._token === 'undefined' || typeof this._token.refreshToken === 'undefined' || !this._token.refreshToken) {
      this.log.debug('Cannot refresh token. Getting new token.');
      return this.getToken();
    }
    try {
      const response = await fetch(DAIKIN_API_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.user,
          refreshToken: this._token.refreshToken,
        }),
      });

      if (!response.ok) {
        logError(
          this.log,
          `Request ${DAIKIN_API_TOKEN_URL} failed with status ${response.status} - ${response.statusText}.`,
          await response.text(),
        );
        return;
      }

      const token: DaikinTokenResponse = await response.json();
      this.setToken(token);
    } catch (error) {
      logError(this.log, 'Error refreshing token:', error);
    }
  }

  private async getRequest(uri: string) {
    if (new Date() >= this._tokenExpiration) {
      await this.refreshToken();
    }
    if (!this._token) {
      this.log.error('No token for request: %s', uri);
      return undefined;
    }
    try {
      const response = await fetch(uri, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._token.accessToken}`,
        },
      });

      if (!response.ok) {
        logError(this.log, `Request ${uri} failed with status ${response.status} - ${response.statusText}.`, await response.text());
        return undefined;
      }
      return response.json();
    } catch (error) {
      logError(this.log, `Error with getRequest: ${uri}`, error);
      return undefined;
    }
  }
}
