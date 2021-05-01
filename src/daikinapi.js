"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.DaikinApi = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
var axios_1 = require("axios");
//import { DaikinOnePlusPlatform } from './platform';
var DaikinApi = /** @class */ (function () {
    function DaikinApi(user, password) {
        this.user = user;
        this.password = password;
    }
    DaikinApi.prototype.Initialize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, this.getToken()
                        .then(function () { return _this.getLocation(); })
                        .then(function () { return _this.getDevices(); })
                        .then(function () {
                        console.log(_this._locations);
                        console.log(_this._devices);
                        //console.log(this._deviceData);
                    })];
            });
        });
    };
    DaikinApi.prototype.getToken = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, axios_1["default"].post('https://api.daikinskyport.com/users/auth/login', {
                        email: this.user,
                        password: this.password
                    }, {
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        }
                    }).then(function (response) {
                        _this.setToken(response);
                    })];
            });
        });
    };
    DaikinApi.prototype.setToken = function (response) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (response.status === 200) {
                    this._token = response.data;
                    this._tokenExpiration = new Date();
                    this._tokenExpiration.setSeconds(this._tokenExpiration.getSeconds() + this._token.accessTokenExpiresIn);
                }
                return [2 /*return*/];
            });
        });
    };
    DaikinApi.prototype.getLocation = function () {
        var _this = this;
        return this.getRequest('https://api.daikinskyport.com/locations')
            .then(function (response) { return _this._locations = response; });
    };
    DaikinApi.prototype.getDevices = function () {
        var _this = this;
        return this.getRequest('https://api.daikinskyport.com/devices')
            .then(function (response) { return _this._devices = response; });
    };
    DaikinApi.prototype.getDeviceData = function (device) {
        return this.getRequest("https://api.daikinskyport.com/deviceData/" + device);
    };
    DaikinApi.prototype.refreshToken = function () {
        var _this = this;
        axios_1["default"].post('https://api.daikinskyport.com/users/auth/token', {
            email: this.user,
            refreshToken: this._token.refreshToken
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        }).then(function (response) { return _this.setToken(response); });
    };
    DaikinApi.prototype.getRequest = function (uri) {
        if (new Date() >= this._tokenExpiration) {
            console.log('Refreshing token.');
            this.refreshToken();
        }
        return axios_1["default"].get(uri, {
            headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + this._token.accessToken
            }
        }).then(function (response) {
            return response.data;
        });
    };
    DaikinApi.prototype.getDeviceList = function () {
        return this._devices;
    };
    DaikinApi.prototype.getCurrentStatus = function (deviceId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.getDeviceData(deviceId).then(function (response) {
                        return response.equipmentStatus;
                    })];
            });
        });
    };
    DaikinApi.prototype.getTargetStatus = function (deviceId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.getDeviceData(deviceId).then(function (response) {
                        return response.mode;
                    })];
            });
        });
    };
    return DaikinApi;
}());
exports.DaikinApi = DaikinApi;
var api = new DaikinApi('daikin@jhfamily.net', 'yHC7CX$9TP6A');
api.Initialize().then(function () {
    return api.getTargetStatus('ac230f4c-d900-11ea-b7e2-9bb9e77f74dd');
}).then(function (response) { return console.log('Status: ', response); });
