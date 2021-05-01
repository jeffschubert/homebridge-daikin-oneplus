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
          console.log(this._locations);
          console.log(this._devices);
          //console.log(this._deviceData);
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
        console.log('Refreshing token.');
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

    async getCurrentStatus(deviceId: string): Promise<number> {
      return this.getDeviceData(deviceId).then((response)=>{
        return response.equipmentStatus;
      });
    }

    async getCurrentTemp(deviceId: string): Promise<number> {
      return this.getDeviceData(deviceId).then((response)=>{
        return response.tempIndoor;
      });
    }

    async getTargetState(deviceId: string): Promise<number> {
      return this.getDeviceData(deviceId).then((response)=>{
        return response.mode;
      });
    }

    async setTargetState(deviceId: string, requestedState: number){
      this.platform.log.debug(`Setting target state ${requestedState} for device ${deviceId}`);
      return axios.put(`https://api.daikinskyport.com/deviceData/${deviceId}`, {
        'equipmentStatus': requestedState,
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this._token.accessToken,
        },
      })
        .then(res => {
          this.platform.log.debug(`response: ${res.data}`);
        })
        .catch(error => {
          this.platform.log.error(`Error updating target state: ${error}`);
        });
    }
}

/*const api = new DaikinApi('daikin@jhfamily.net', 'yHC7CX$9TP6A');
api.Initialize().then(()=>{
  return api.getTargetStatus('ac230f4c-d900-11ea-b7e2-9bb9e77f74dd');
}).then((response)=>console.log('Status: ', response));
*/