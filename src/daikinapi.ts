/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios';

/**
 * Log levels to indicate importance of the logged message.
 * Every level corresponds to a certain color.
 *
 * - INFO: no color
 * - WARN: yellow
 * - ERROR: red
 * - DEBUG: gray
 *
 * Messages with DEBUG level are only displayed if explicitly enabled.
 */
export declare const enum LoggerLevel {
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  DEBUG = 'debug'
}

export declare const enum TargetHeatingCoolingState {
  OFF = 0,
  HEAT = 1,
  COOL = 2,
  AUTO = 3,
  AUXILIARY_HEAT = 4
}

export type LogMessage = (level: LoggerLevel, message: string, ...parameters: any[]) => void

export class DaikinApi{
    private _token;
    private _locations;
    private _tokenExpiration;
    private _devices;
    private _isInitialized = false;

    constructor(
        private readonly user : string,
        private readonly password : string,
        private readonly refreshInterval : number,
        private readonly log : LogMessage,
    ){

    }

    async Initialize(){
      await this.getToken();
      
      if(this._token === undefined || this._token === null){
        this.log(LoggerLevel.ERROR, 'Unable to retrieve token.');
        return;
      }

      await this.getLocations();
      await this.getDevices();
      
      if(this._locations !== undefined){
        this.log(LoggerLevel.INFO, `Found ${this._locations.length} location(s): `);
        this._locations.forEach(element => {
          this.log(LoggerLevel.INFO, `Location: ${element.name}`);
        });
      } else{
        this.log(LoggerLevel.INFO, 'No locations found.');
        return;
      }
      if(this._devices !== undefined){
        this.log(LoggerLevel.INFO, `Found ${this._devices.length} device(s): `);
        this._locations.forEach(element => {
          this.log(LoggerLevel.INFO, `Device: ${element.name}`);
        });
      }else {
        this.log(LoggerLevel.INFO, 'No devices found.');
        return;
      }

      await this.getData();
      this.log(LoggerLevel.INFO, 'Loaded initial data.');
      this._isInitialized = true;
    }

    isInitialized(): boolean {
      return this._isInitialized;
    }

    async getData(){
      this.log(LoggerLevel.DEBUG, 'Getting data...');
      this._devices.forEach(async device => {
        const data = await this.getDeviceData(device.id);
        if(!data){
          this.log(LoggerLevel.ERROR, `Unable to retrieve data for ${device.name}.`);
          return;
        }
        device.data = data;
      });
      this.log(LoggerLevel.DEBUG, 'Updated data.');
        
      setTimeout(async ()=>{
        await this.getData();
      }, this.refreshInterval*1000);
    }

    async getToken(){
      this.log(LoggerLevel.DEBUG, 'Getting token...');
      return axios.post('https://api.daikinskyport.com/users/auth/login', {
        email: this.user,
        password: this.password,
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }).then((response)=>this.setToken(response))
        .catch((error) => {
          if (error.response) {
            // When response status code is out of 2xx range 
            this.log(LoggerLevel.ERROR, 'Error with token response:');
            this.log(LoggerLevel.ERROR, error.response.data);
            this.log(LoggerLevel.ERROR, error.response.status);
            this.log(LoggerLevel.ERROR, error.response.headers);
          } else if (error.request) {
            // When no response was received after request was made
            this.log(LoggerLevel.ERROR, 'Error with token request:');
            this.log(LoggerLevel.ERROR, error.request);
          } else {
            // Error
            this.log(LoggerLevel.ERROR, 'General error getting token:');
            this.log(LoggerLevel.ERROR, error.message);
          }
        });
    }

    async setToken(response: AxiosResponse<any>){
      this._token = response.data;
      this._tokenExpiration = new Date();
      //Set expiration a little early.
      this._tokenExpiration.setSeconds(
        this._tokenExpiration.getSeconds() 
      + this._token.accessTokenExpiresIn 
      - this.refreshInterval);
    }

    getLocations(){
      return this.getRequest('https://api.daikinskyport.com/locations')
        .then((response)=>this._locations = response);
    }

    getDevices(){
      return this.getRequest('https://api.daikinskyport.com/devices')
        .then((response)=>this._devices = response);
    }

    getDeviceData(device){
      return this.getRequest(`https://api.daikinskyport.com/deviceData/${device}`);
    }

    refreshToken(){
      if(typeof this._token === 'undefined' ||
      typeof this._token.refreshToken === 'undefined' ||
      !this._token.refreshToken){
        this.log(LoggerLevel.DEBUG, 'Cannot refresh token. Getting new token.');
        return this.getToken();
      }
      axios.post('https://api.daikinskyport.com/users/auth/token', {
        email: this.user,
        refreshToken: this._token.refreshToken,
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }).then((response)=>this.setToken(response))
        .catch((error) => this.logError('Error retrieving token:', error));
    }

    getRequest(uri: string){
      if(new Date() >= this._tokenExpiration){
        this.refreshToken();
      }
      if(!this._token) {
        this.log(LoggerLevel.ERROR, `No token for request: ${uri}`);
        return Promise.resolve();
      }
      return axios.get(uri, {
        headers:{
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + this._token.accessToken,
        },
      }).then((response)=>response.data) 
        .catch((error) => {
          this.logError(`Error with getRequest: ${uri}`, error);
          return Promise.resolve();
        });
    }

    getDeviceList(){
      return this._devices;
    }

    getDeviceName(deviceName: number, deviceNameCustom: string): string {
      switch(deviceName){
        case 0: return deviceNameCustom;
        case 1: return 'main room';
        case 2: return 'upstairs';
        case 3: return 'downstairs';
        case 4: return 'hallway';
        case 5: return 'bedroom';
        case 6: return 'kitchen';
        default: return 'other';
      }
    }
    
    deviceHasData(deviceId: string): boolean {
      const device = this._devices.find(e=>e.id === deviceId);
      if(typeof device === 'undefined' ||
      typeof device.data === 'undefined'){
        return false;
      }
      return true;
    }

    getCurrentStatus(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.equipmentStatus;
    }

    getCurrentTemp(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.tempIndoor;
    }

    getTargetState(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.mode;
    }

    getOneCleanFanActive(deviceId: string): boolean {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.oneCleanFanActive;
    }

    getTargetTemp(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      switch(device.data.mode){
        case TargetHeatingCoolingState.HEAT:
        case TargetHeatingCoolingState.AUXILIARY_HEAT:
          return device.data.hspActive;
        case TargetHeatingCoolingState.COOL:
        case TargetHeatingCoolingState.AUTO:
        default:
          return device.data.cspActive;
      }
    }

    getCurrentHumidity(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.humIndoor;
    }

    getOutdoorHumidity(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.humOutdoor;
    }

    getTargetHumidity(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.humSP;
    }

    getAirQualityLevel(deviceId: string, forIndoor:boolean): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return forIndoor ? device.data.aqIndoorLevel : device.data.aqOutdoorLevel;
    }

    getOzone(deviceId: string, forIndoor:boolean): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return forIndoor ? 0 : device.data.aqOutdoorOzone;
    }

    getAirQualityValue(deviceId: string, forIndoor:boolean): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return forIndoor ? device.data.aqIndoorValue : device.data.aqOutdoorValue;
    }

    getPM2_5Density(deviceId: string, forIndoor:boolean): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return forIndoor ? device.data.aqIndoorParticlesValue : device.data.aqOutdoorParticles;
    }

    getVocDensity(deviceId: string, forIndoor:boolean): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return forIndoor ? device.data.aqIndoorVOCValue : 0;
    }

    getDisplayUnits(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.units;
    }

    getAwayState(deviceId: string): boolean {
      const device = this._devices.find(e=>e.id===deviceId);
      return device.data.geofencingAway && device.data.geofencingEnabled;
    }

    async setTargetTemp(deviceId: string, requestedTemp: number): Promise<boolean>{
      const deviceData = await this.getDeviceData(deviceId);
      if(!deviceData){
        this.log(LoggerLevel.INFO, 'Device data could not be retrieved. Unable to set target temp.');
        return false;
      }

      let requestedData = {};
      let autoHsp = deviceData.hspHome;
      switch(deviceData.mode){
        case TargetHeatingCoolingState.HEAT:
        case TargetHeatingCoolingState.AUXILIARY_HEAT:
          if(deviceData.schedEnabled){
            requestedData = {
              schedOverride: 1, 
              hspHome: requestedTemp,
            };
          } else{
            requestedData = {hspHome: requestedTemp};
          }
          break;
        case TargetHeatingCoolingState.COOL:
          if(deviceData.schedEnabled){
            requestedData = {
              schedOverride: 1, 
              cspHome: requestedTemp,
            };
          } else{
            requestedData = {cspHome: requestedTemp};
          }
          break;
        case TargetHeatingCoolingState.AUTO:
          //In auto mode, also set heating set point if it would be too close to the requested temp
          autoHsp = deviceData.hspHome + deviceData.tempDeltaMin >= requestedTemp 
            ? requestedTemp - deviceData.tempDeltaMin 
            : deviceData.hspHome;
          //TODO: Come up with a way to detect when the requestedTemp is intended by the user to be the heating set point instead.
          // i.e. it is winter and they're wanting to make it warmer instead of cooler. Daikin app allows setting both in auto mode
          //   but HomeKit only allows setting a single temp
          if(deviceData.schedEnabled){
            requestedData = {
              schedOverride: 1, 
              cspHome: requestedTemp,
              hspHome: autoHsp,
            };
          } else{
            requestedData = {
              cspHome: requestedTemp,
              hspHome: autoHsp,
            };
          }
          break;
        default:
          this.log(LoggerLevel.INFO, `Device is in an unknown state: ${deviceData.mode}. Unable to set target temp.`);
          return false;
      }
      this.log(LoggerLevel.DEBUG, 'setTargetTemp-> requestedData: ', requestedData);
      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setTargetTemp-> response: ', res.data);
          return true;
        })
        .catch((error) => this.logError('Error updating target temp: ', error));
    }

    async setTargetState(deviceId: string, requestedState: number): Promise<boolean>{
      this.log(LoggerLevel.DEBUG, `setTargetState-> device:${deviceId}; state:${requestedState}`);
      const requestedData = {mode: requestedState};

      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setTargetState-> response: ', res.data);
          return true; 
        })
        .catch((error) => this.logError('Error updating target state:', error));
    }

    async setOneCleanFanActive(deviceId: string, requestedState: boolean): Promise<boolean>{
      this.log(LoggerLevel.DEBUG, `setOneCleanFanActive-> device:${deviceId}; state:${requestedState}`);
      const requestedData = {oneCleanFanActive: requestedState};

      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`,
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setOneCleanFanActive-> response: ', res.data);
          return true;
        })
        .catch((error) => this.logError('Error updating one clean fan:', error));
    }

    async setDisplayUnits(deviceId: string, requestedUnits: number) : Promise<boolean>{
      this.log(LoggerLevel.DEBUG, `setDisplayUnits-> device:${deviceId}; units:${requestedUnits}`);
      const requestedData = {units: requestedUnits};

      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setDisplayUnits-> response: ', res.data);
          return true;
        })
        .catch((error) => this.logError('Error updating target state:', error));
    }

    async setTargetHumidity(deviceId: string, requestedHumidity: number) : Promise<boolean>{
      this.log(LoggerLevel.DEBUG, `setTargetHumidity-> device:${deviceId}; humidity:${requestedHumidity}`);
      const requestedData = {humSP: requestedHumidity};
      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setTargetState-> response: ', res.data);
          return true;
        })
        .catch((error) => this.logError('Error updating target humidity:', error));
    }

    async setAwayState(deviceId: string, requestedState: boolean): Promise<boolean>{
      const deviceData = await this.getDeviceData(deviceId);
      if(!deviceData){
        this.log(LoggerLevel.INFO, 'Device data could not be retrieved. Unable to set away state.');
        return false;
      }

      let requestedData = {};
      switch(deviceData.geofencingEnabled){
        case true: //thermostat has geofencing enabled, thus we can just toggle away state
          requestedData = {geofencingAway: requestedState};
          break;
        case false: //thermostat has geofencing disabled, thus we need to set it and also toggle away state
          if(requestedState){
            requestedData = {
              geofencingEnabled: true, 
              geofencingAway: true,
            };
          } else{
            // nothing to do. geofencing is disabled so away state can't be set.
            this.log(LoggerLevel.INFO, 'Device has geofencing disabled. Unable to set away state to off.');
            return true;
          }
          break;
      }
      this.log(LoggerLevel.DEBUG, 'setAwayState-> requestedData: ', requestedData);
      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.log(LoggerLevel.DEBUG, 'setAwayState-> response: ', res.data);
          return true;
        })
        .catch((error) => this.logError('Error updating away state: ', error));
    }

    logError(message: string, error): boolean{
      this.log(LoggerLevel.ERROR, message);
      if (error.response) {
        // When response status code is out of 2xx range 
        this.log(LoggerLevel.ERROR, 'Error with response:');
        this.log(LoggerLevel.ERROR, error.response.data);
        this.log(LoggerLevel.ERROR, error.response.status);
        this.log(LoggerLevel.ERROR, error.response.headers);
      } else if (error.request) {
        // When no response was received after request was made
        this.log(LoggerLevel.ERROR, 'Error with request:');
        this.log(LoggerLevel.ERROR, error.request);
      } else {
        // Error
        this.log(LoggerLevel.ERROR, 'General error:');
        this.log(LoggerLevel.ERROR, error.message);
      }
      return false;
    }
}