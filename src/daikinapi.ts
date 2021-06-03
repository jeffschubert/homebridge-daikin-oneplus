/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from 'axios';
import { DaikinOnePlusPlatform } from './platform';
  
export class DaikinApi{
    private _token;
    private _locations;
    private _tokenExpiration;
    private _devices;

    constructor(
        private readonly user : string,
        private readonly password : string,
        private readonly platform : DaikinOnePlusPlatform,
    ){

    }

    async Initialize(){
      return this.getToken()
        .then(()=>this.getLocation())
        .then(()=>this.getDevices())
        .then(()=>{
          this.platform.log.debug(this._locations);
          this.platform.log.debug(this._devices);
        });

    }

    async getToken(){
      return axios.post('https://api.daikinskyport.com/users/auth/login', {
        email: this.user,
        password: this.password,
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      },
      ).then((response)=>{
        this.setToken(response);
      });
    }

    async setToken(response: AxiosResponse<any>){
      if(response.status === 200){
        this._token = response.data;
        this._tokenExpiration = new Date();
        this._tokenExpiration.setSeconds(this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn);
      }
    }

    getLocation(){
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
      axios.post('https://api.daikinskyport.com/users/auth/token', {
        email: this.user,
        refreshToken: this._token.refreshToken,
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }).then((response)=>this.setToken(response));
    }

    getRequest(uri: string){
      if(new Date() >= this._tokenExpiration){
        this.platform.log.info('Refreshing token.');
        this.refreshToken();
      }
      return axios.get(uri, {
        headers:{
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + this._token.accessToken,
        },
      }).then((response)=>{
        return response.data;
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
    
    getCurrentStatus(deviceData: any): number {
      return deviceData.equipmentStatus;
    }

    getCurrentTemp(deviceData: any): number {
      return deviceData.tempIndoor;
    }

    getTargetState(deviceData: any): number {
      return deviceData.mode;
    }

    getTargetTemp(deviceData: any): number {
      this.platform.log.debug('GET TargetTemp');
      switch(deviceData.mode){
        case 1: //heat
        case 4: //emrg heat
          return deviceData.hspActive;
        case 2: //cool
        case 3: //auto
        default:
          return deviceData.cspActive;
      }
    }

    getCurrentHumidity(deviceData: any): number {
      return deviceData.humIndoor;
    }

    getOutdoorHumidity(deviceData: any): number {
      return deviceData.humOutdoor;
    }

    getTargetHumidity(deviceData: any): number {
      return deviceData.humSP;
    }

    getAirQualityLevel(deviceData: any, forIndoor:boolean): number {
      return forIndoor ? deviceData.aqIndoorLevel : deviceData.aqOutdoorLevel;
    }

    getOzone(deviceData: any, forIndoor:boolean): number {
      return forIndoor ? 0 : deviceData.aqOutdoorOzone;
    }

    getAirQualityValue(deviceData: any, forIndoor:boolean): number {
      return forIndoor ? deviceData.aqIndoorValue : deviceData.aqOutdoorValue;
    }

    getPM2_5Density(deviceData: any, forIndoor:boolean): number {
      return forIndoor ? deviceData.aqIndoorParticlesValue : deviceData.aqOutdoorParticles;
    }

    getVocDensity(deviceData: any, forIndoor:boolean): number {
      return forIndoor ? deviceData.aqIndoorVOCValue : 0;
    }

    getDisplayUnits(deviceData: any): number {
      return deviceData.units;
    }

    async setTargetTemp(deviceId: string, deviceData: any, requestedTemp: number): Promise<boolean>{
      this.platform.log.debug(`setTargetTemp-> device:${deviceId}; temp:${requestedTemp}`);
      let requestedData = {};
      switch(deviceData.mode){
        case 1: //heat
          requestedData = {hspHome: requestedTemp};
          break;
        case 2: //cool
        case 3: //auto
          requestedData = {cspHome: requestedTemp};
          break;
        case 4: //emrg heat
          this.platform.log.info('Device is in Emergency Heat. Unable to set target temp.');
          return false;
        default:
          this.platform.log.info(`Device is in an unknown state: ${deviceData.mode}. Unable to set target temp.`);
          return false;
      }
      this.platform.log.debug('setTargetTemp-> requestedData: ', requestedData);
      await axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.platform.log.debug('setTargetTemp-> response: ', res.data);
        })
        .catch(error => {
          this.platform.log.error(`Error updating target temp: ${error}`);
          return false;
        });
      return true;
    }

    async setTargetState(deviceId: string, deviceData: any, requestedState: number): Promise<boolean>{
      this.platform.log.debug(`setTargetState-> device:${deviceId}; state:${requestedState}`);
      const requestedData = {mode: requestedState};

      await axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.platform.log.debug('setTargetState-> response: ', res.data);
        })
        .catch(error => {
          this.platform.log.error(`Error updating target state: ${error}`);
          return false;
        });
      return true;
    }

    async setDisplayUnits(deviceId: string, requestedUnits: number) : Promise<boolean>{
      this.platform.log.debug(`setDisplayUnits-> device:${deviceId}; units:${requestedUnits}`);
      const requestedData = {units: requestedUnits};

      await axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.platform.log.debug('setDisplayUnits-> response: ', res.data);
        })
        .catch(error => {
          this.platform.log.error(`Error updating target state: ${error}`);
          return false;
        });
      return true;
    }

    async setTargetHumidity(deviceId: string, requestedHumidity: number) : Promise<boolean>{
      this.platform.log.debug(`setTargetHumidity-> device:${deviceId}; humidity:${requestedHumidity}`);
      const requestedData = {humSP: requestedHumidity};
      await axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, 
        requestedData, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this._token.accessToken}`,
          },
        })
        .then(res => {
          this.platform.log.debug('setTargetState-> response: ', res.data);
        })
        .catch(error => {
          this.platform.log.error(`Error updating target humidity: ${error}`);
          return false;
        });
      return true;
    }
}