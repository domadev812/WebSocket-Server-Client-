'use strict';

var http = require('http').Server(app);
var WebSocketServer = require('ws').Server;
var express = require('express');
var mongoose = require('mongoose');
var mongoDB = 'mongodb://root:rootroot@ds245337.mlab.com:45337/websocketdb';

var app = express();
var PORT = 3100;
var db

var messages = [];
var clientSockets = new Array();
var jsonDeviceInfo = new Array();
var jsonModeInfo = new Array();
var arrayScheduleInfo = new Array();
var jsonModeDeviceInfo = new Array();

var serverSocket = null;
var masterSocket = null;
var loadModeFlag = false;
var pendingCommand = {};
var currentDateTime = "";
var wss;

mongoose.connect(mongoDB);
mongoose.Promise = global.Promise;
var db = mongoose.connection;
db.on('error', function(){
  console.log('DBConnection Error')
});
    
var Schema = mongoose.Schema;
var DeviceSchema = new Schema({
    device_name: String,
    master: Boolean,
    state: Number
});
var ModeSchema = new Schema({
    mode_name: String,
    mode_id: String,
    mode_type: Boolean,  //Pre-defined: True, User-defined: False
    command: String,
    default_option: String
});
var ModeDeviceSchema = new Schema({    
    mode_id: String,
    device_name: String,
    command: String,
    option_value: String
});
var ScheduleSchema = new Schema({    
    mode_id: String,
    day: String,
    time: String,
    time_part: String
});
var DeviceModel = mongoose.model('device_lists', DeviceSchema);
var ModeModel = mongoose.model('mode_lists', ModeSchema);
var ModeDeviceModel = mongoose.model('mode_device_lists', ModeDeviceSchema);
var ScheduleModel = mongoose.model('schedule_lists', ScheduleSchema);

DeviceModel.find(function (err, devices) {
    if (err) return console.error(err);
    devices.forEach(function(device) {
        jsonDeviceInfo[device.device_name] = device;    
        jsonDeviceInfo[device.device_name].state = 0;
    })    
    if(serverSocket != null)
        registerWebUI(serverSocket);        
})

ModeModel.find(function (err, modes) {
    if (err) return console.error(err);
    modes.forEach(function(mode) {
        jsonModeInfo[mode.mode_id] = mode;       
        let condition =  {'mode_id': mode.mode_id};    
        ModeDeviceModel.find(condition, function(err, modeDevices){
            if (err) return handleError(err);            
            jsonModeDeviceInfo[condition.mode_id] = modeDevices;
        })
    })      
    loadModeFlag = true;    
    if(serverSocket != null)
        registerWebUI(serverSocket);  
})
ScheduleModel.find(function (err, schedules) {
    if (err) return console.error(err);        
    arrayScheduleInfo = schedules;                    
})

http.listen(process.env.PORT || 3000, function(){
    console.log('listening on *:' + process.env.PORT || 3000);    
});
console.log('Server listening at port %d', http.address().port);

wss = new WebSocketServer({server: http});
  wss.on('connection', function (ws) {
    console.log("Device is connected");    
    ws.on('message', function (message) {        
        message = JSON.parse(message);
        getDateTime();
        if(message.action == "register_webui")
        {            
            console.log("Receive register server request");
            registerWebUI(ws);
        } else if(message.action == "register_client"){
            console.log("Receive register client request");
            registerClient(ws, message);
        } else if(message.action == "execute_command"){
            console.log("Execute command");
            executeCommand(message);
        } else if(message.action == "execute_result"){
            console.log("Execute result");
            executeResult();
        } else if(message.action == "add_mode"){
            console.log("Add Mode");
            addMode(message);
        } else if(message.action == "get_mode_info") {
            console.log("Get Mode Info");
            getModeInfo(message.mode_id);
        } else if(message.action == "update_mode") {
            console.log("Update Mode Info");
            updateModeInfo(message);
        } else if(message.action == "get_schedule_info") {
            console.log("Get Schedule Info");
            getScheduleInfo();
        } else if(message.action == "update_schedule") {
            console.log("Update Schedule Info");
            updateScheduleInfo(message);
        }
    });

    ws.on('close', function(){
        console.log("Disconnected")  
        for(var key in clientSockets)
        {            
            if(clientSockets[key] == ws)
            {
                jsonDeviceInfo[key].state = 0;   
                if(jsonDeviceInfo[key].master == true)
                    masterSocket = null;    
                return;        
            }
        }
        if(ws == serverSocket)
            serverSocket = null;
    });
});

app.use('/static', express.static(__dirname + '/static'));
    
var bodyParser = require('body-parser')
app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));

app.get('/', function(req, res){
    res.sendFile(__dirname + 'index.html');
});

var executeResult = function(){
    var resultPacket = {};
    resultPacket.action = "execute_result";
    resultPacket.result = "Success";
    resultPacket.time = currentDateTime;
    if(serverSocket != null)
        serverSocket.send(JSON.stringify(resultPacket));       
}
var executeCommand = function(message)
{           
    for(var key in jsonDeviceInfo)
    {
        if(key == message.nick_name)
        {
            if(jsonDeviceInfo[key].state == 1)
            {
                var clientSocket = clientSockets[message.nick_name];
                var commandPacket = {};
                commandPacket.action = "execute_command";
                commandPacket.command = message.command;
                commandPacket.url = message.url;
                commandPacket.time = currentDateTime;
                clientSocket.send(JSON.stringify(commandPacket));
                return;
            }
        }
    }

    pendingCommand["nick_name"] = message.nick_name;
    pendingCommand["command"] = message.command;
    pendingCommand["url"] = message.url;
    pendingCommand["state"] = "pending";
    
    if(masterSocket != null)
    {
        var commandPacket = {};        
        commandPacket.action = "wakeup_device";
        commandPacket.nick_name = message.nick_name;     
        commandPacket.time = currentDateTime;
        masterSocket.send(JSON.stringify(commandPacket));               
        return;
    }

    var resultPacket = {};
    resultPacket.action = "execute_result";
    resultPacket.result = "Failure";
    resultPacket.time = currentDateTime;
    serverSocket.send(JSON.stringify(resultPacket))        
}

var registerWebUI = function(ws)
{    
    serverSocket = ws;
    var keyDeviceArray = new Array();
    var modeJSON = {};
    for(var key in jsonDeviceInfo)
    {
        keyDeviceArray.push(key);
    }
    for(var key in jsonModeInfo)
    {
        modeJSON[key] = jsonModeInfo[key];
    }    
    var message = {};
    message.action = "init_devices";
    message.device_list = keyDeviceArray;
    message.mode_list = modeJSON;         
    message.mode_flag = loadModeFlag;
    message.time = currentDateTime;
    serverSocket.send(JSON.stringify(message));
} 

var registerClient = function(ws, message)
{  
    var existFlag = false;    
    for(var key in jsonDeviceInfo)
    {
        if(key == message.nick_name)
            existFlag = true;
    }    
    if(!existFlag)
    {
        var deviceInfo = new Array();
        deviceInfo.master = message.master;
        deviceInfo.state = 1;
        deviceInfo.device_name = message.nick_name;

        var device = new DeviceModel(deviceInfo);
        // Save the new model instance, passing a callback
        device.save(function (err) {
            if (err) return handleError(err);            
        });

        jsonDeviceInfo[message.nick_name] = deviceInfo;                
        if(serverSocket != null)
        {
            var data = {};
            data.action = "add_device";  
            data.nick_name = message.nick_name;
            data.time = currentDateTime;
            serverSocket.send(JSON.stringify(data));
         }
    }
    else{
        jsonDeviceInfo[message.nick_name].state = 1;                
    }        
    clientSockets[message.nick_name] = ws;
    if(message.master == true)
        masterSocket = ws;

    if(message.nick_name == pendingCommand.nick_name && pendingCommand.state == "pending")
    {
        var data = {};
        data.action = "execute_command";
        data.command = pendingCommand.command;
        data.url = pendingCommand.url;
        data.time = currentDateTime;
        ws.send(JSON.stringify(data));       
        pendingCommand.state = "done";        
    }
    sendUpdatedDataToClient(message.nick_name);
}
var addMode = function(message) {
    var newMode = {
        mode_name: message.mode_name,
        mode_id: message.mode_id,
        mode_type: false,
        command: message.mode_command,
        default_option: ''
    };    
    var data = {}
    data.action = "add_mode_callback";
    if(jsonModeInfo.hasOwnProperty(message.mode_id)){                            
        data.error = true;
        data.comment = "Mode name should be different";        
        if(serverSocket != null) {
            serverSocket.send(JSON.stringify(data));  
        }
    } else {
        ModeModel.create(newMode, function (err, savedMode) {
            if (err) return handleError(err);                        
            jsonModeInfo[message.mode_id] = savedMode;
            var arrayModeDevice = new Array();
            message.device_list.forEach(function(device) {
                var modeDevice = {
                    mode_id: message.mode_id,
                    device_name: device.device_name,
                    command: message.mode_command,
                    option_value: device.option_value
                };
                arrayModeDevice.push(modeDevice);
                ModeDeviceModel.create(modeDevice, function (err, object){
                    if (err) return handleError(err);
                });    
            })
            jsonModeDeviceInfo[message.mode_id] = arrayModeDevice; 
            data.error = false;
            data["added_mode"] = savedMode;
            if(serverSocket != null) {
                serverSocket.send(JSON.stringify(data));  
            }
            sendUpdatedDataToClient();
        });                        
    }    
}

var getModeInfo = function(modeID) {
    ModeDeviceModel.find({'mode_id': modeID}, function(err, modeDevices){
        if (err) return handleError(err);
        var modeDeviceJSON = {};
        modeDevices.forEach(function(modeDevice) {
            modeDeviceJSON[modeDevice.device_name] = modeDevice;                    
        })
        var message = {};
        message.action = "get_mode_info";
        message.mode_device_list = modeDeviceJSON;             
        message.time = currentDateTime;
        serverSocket.send(JSON.stringify(message));   
    })
}

var updateModeInfo = function(message) {
    var modeDeviceList = message.mode_device_list;
    var modeID = '';
    var arrayModeDevice = new Array();
    for(var key in modeDeviceList) {        
        var modeDevice = new ModeDeviceModel(modeDeviceList[key]);
        modeID = modeDevice.mode_id;
        arrayModeDevice.push(modeDevice);
        ModeDeviceModel.findByIdAndUpdate(modeDevice._id, modeDevice, function(err){
            if (err) return handleError(err);            
        });
        var message = {};
        message.action = "update_mode_info";
        message.error = false;
        serverSocket.send(JSON.stringify(message));
    }
    if(modeID != '') {
        jsonModeDeviceInfo[modeID] = arrayModeDevice; 
        sendUpdatedDataToClient();
    }
}

var updateScheduleInfo = function(message) {
    var scheduleList = message.schedule_list;    
    scheduleList.forEach(function(schedule, index){        
        if(schedule.hasOwnProperty('_id')) {    
            ScheduleModel.findByIdAndUpdate(schedule._id, schedule, function(err){
                if (err) return handleError(err);                 
            });
            arrayScheduleInfo[index] = schedule;
        } else {
            arrayScheduleInfo[index] = schedule;
            schedule.index = index;
            ScheduleModel.create(schedule, function(err, created_instance){                
                if (err) return handleError(err);
                var message = {};
                message.action = "update_schedule_info_item";
                message.index = index;
                message.id = created_instance._id;
                if(serverSocket != null)
                    serverSocket.send(JSON.stringify(message));
            })
        }             
        var message = {};
        message.action = "update_schedule_info";
        message.error = false;
        if(serverSocket != null)
            serverSocket.send(JSON.stringify(message));               
    });    
    sendUpdatedDataToClient(); 
}

var getScheduleInfo = function() {
    var message = {};
    message.action = "get_schedule_info";
    if(serverSocket != null) {
        message.schedule_list = arrayScheduleInfo;     
        if(serverSocket != null)   
            serverSocket.send(JSON.stringify(message));        
    }
}

var makeDataPacket = function(device_name) {    
    var schedules = [];
    arrayScheduleInfo.map(function(obj){
        var mode_id = obj.mode_id;
        var schedule = {};
        if(jsonModeInfo.hasOwnProperty(mode_id)) {
            var mode = jsonModeInfo[mode_id];
            schedule.mode_name = mode.mode_name;
            schedule.day = obj.day;
            schedule.time = obj.time+ obj.time_part;            
            if(mode.mode_type) {                                
                schedule.command = mode.command;
                schedule.option = mode.default_option;
                schedules.push(schedule);
            } else {
                var mode_device = jsonModeDeviceInfo[mode_id];                              
                mode_device.map(function(obj1){
                    if(obj1.device_name == device_name) {
                        schedule.command = obj1.command;
                        schedule.option = obj1.option_value;
                        schedules.push(schedule);
                    }
                });
            }
        }
    });   
    return schedules; 
}

var sendUpdatedDataToClient = function(deviceName = '') {
    
    var modeJSON = {};   
    var modeDeviceJSON = {};

    for(var key in jsonModeInfo)
    {
        modeJSON[key] = jsonModeInfo[key];
    }
    for(var key in jsonModeDeviceInfo)
    {
        modeDeviceJSON[key] = jsonModeDeviceInfo[key];
    }

    if(deviceName != '') {
        var dataPacket = {};
        dataPacket.action = "get_mode_schedule_info";
        dataPacket.schedule_list = JSON.stringify(makeDataPacket(deviceName));
        console.log(dataPacket);
        var clientSocket = clientSockets[deviceName];
        if(clientSocket != null)
            clientSocket.send(JSON.stringify(dataPacket));         
        return;
    }
    for(var key in jsonDeviceInfo)
    {        
        if(jsonDeviceInfo[key].state == 1)
        {
            console.log(key);
            var clientSocket = clientSockets[key];
            var dataPacket = {};
            dataPacket.action = "get_mode_schedule_info";
            dataPacket.schedule_list = JSON.stringify(makeDataPacket(key));            
            if(clientSocket != null)
                clientSocket.send(JSON.stringify(dataPacket));            
        }        
    }
}

var getDateTime = function() {
    var currentdate = new Date();
    var day = currentdate.getDate();
    var month = currentdate.getMonth() + 1;
    var year = currentdate.getFullYear();
    var hours = currentdate.getHours();
    var minutes = currentdate.getMinutes();
    var seconds = currentdate.getSeconds();    
    currentDateTime = "" + year + "-";
    if(month > 10) currentDateTime += month + "-";
    else currentDateTime += "0" + month + "-";
    if(day > 10) currentDateTime += day + " ";
    else currentDateTime += "0" + day + " ";
    if(hours > 10) currentDateTime += hours + ":";
    else currentDateTime += "0" + hours + ":";
    if(minutes > 10) currentDateTime += minutes + ":";
    else currentDateTime += "0" + minutes + ":";
    if(seconds > 10) currentDateTime += seconds;
    else currentDateTime += "0" + seconds;
    return currentDateTime;
} 

