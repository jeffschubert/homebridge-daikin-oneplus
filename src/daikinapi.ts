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
      await this.getToken();
      await this.getLocation();
      await this.getDevices();
      
      if(this._token === undefined || this._token === null){
        this.platform.log.error('Unable to retrieve token.');
      }
      this.platform.log.info(`Found ${this._locations.length} location(s): `);
      this._locations.forEach(element => {
        this.platform.log.info(`Location: ${element.name}`);
      });
      this.platform.log.info(`Found ${this._devices.length} device(s): `);
      this._locations.forEach(element => {
        this.platform.log.info(`Device: ${element.name}`);
      });

      await this.getData();
      this.platform.log.info('Loaded initial data.');
    }

    async getData(){
      this.platform.log.debug('Getting data...');
      this._devices.forEach(async device => {
        const data = await this.getDeviceData(device.id);
        if(!data){
          this.platform.log.error(`Unable to retrieve data for ${device.name}.`);
          return;
        }
        device.data = data;
      });
      this.platform.log.debug('Updated data.');
        
      setTimeout(async ()=>{
        await this.getData();
      }, this.platform.config.refreshInterval*1000);
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
      )
        .then((response)=>{
          this.setToken(response);
        });
    }

    async setToken(response: AxiosResponse<any>){
      if(response.status === 200){
        this._token = response.data;
        this._tokenExpiration = new Date();
        this._tokenExpiration.setSeconds(this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn);
      } else{
        this.platform.log.error(`Error retrieving token: Status ${response.status}`);
        this.platform.log.error(response.data);
        this.platform.log.error(response.headers);
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
      if(!this._token) {
        this.platform.log.error(`No token for request: ${uri}`);
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

    getTargetTemp(deviceId: string): number {
      const device = this._devices.find(e=>e.id===deviceId);
      switch(device.data.mode){
        case 1: //heat
        case 4: //emrg heat
          return device.data.hspActive;
        case 2: //cool
        case 3: //auto
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

    async setTargetTemp(deviceId: string, requestedTemp: number): Promise<boolean>{
      const deviceData = await this.getDeviceData(deviceId);
      if(!deviceData){
        this.platform.log.info('Device data could not be retrieved. Unable to set target temp.');
        return false;
      }

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

    async setTargetState(deviceId: string, requestedState: number): Promise<boolean>{
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