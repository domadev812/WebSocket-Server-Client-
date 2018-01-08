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

var serverSocket = null;
var masterSocket = null;

var pendingCommand = {};
var currentDateTime = "";

mongoose.connect(mongoDB);
mongoose.Promise = global.Promise;
var db = mongoose.connection;
db.on('error', function(){
  console.log('Error')
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

var DeviceModel = mongoose.model('device_lists', DeviceSchema);
var ModeModel = mongoose.model('mode_lists', ModeSchema);

DeviceModel.find(function (err, devices) {
    if (err) return console.error(err);
    devices.forEach(function(device) {
        jsonDeviceInfo[device.device_name] = device;    
    })
    if(serverSocket != null)
        registerWebUI(serverSocket);    
})

ModeModel.find(function (err, modes) {
    if (err) return console.error(err);
    modes.forEach(function(mode) {
        jsonModeInfo[mode.mode_id] = mode;    
    })      
    if(serverSocket != null)
        registerWebUI(serverSocket);  
})

app.listen(3001, () => {
    console.log('listening on 3001')
})
http.listen(process.env.PORT || 3000, function(){
    console.log('listening on *:' + process.env.PORT || 3000);    
});
console.log('Server listening at port %d', http.address().port);

var wss = new WebSocketServer({server: http});
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
                console.log(jsonDeviceInfo);
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
    serverSocket.send(JSON.stringify(resultPacket))        
}
var executeCommand = function(message)
{
    console.log(message);            
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
                console.log("Send data to " + message.nick_name + " successfully.");
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
        console.log("Send data to master device to wake up " + message.nick_name);        
        return;
    }
    console.log("Failure");

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
    var keyModeArray = new Array();
    var modeJSON = {};
    for(var key in jsonDeviceInfo)
    {
        keyDeviceArray.push(key);
    }
    for(var key in jsonModeInfo)
    {
        keyModeArray.push(key);
        modeJSON[key] = jsonModeInfo[key];
    }    
    var message = {};
    message.action = "init_devices";
    message.device_list = keyDeviceArray;
    message.mode_list = modeJSON;         

    message.time = currentDateTime;
    serverSocket.send(JSON.stringify(message));
    console.log("Send device list to server interface: " + JSON.stringify(message));
} 

var registerClient = function(ws, message)
{  
    console.log("RegiserClient");
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
            console.log('Saved');
        });

        jsonDeviceInfo[message.nick_name] = deviceInfo;        
        console.log("Add device");
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
        console.log("Update device");
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
        console.log("Send pendding comment to " + data.nick_name + " successfully.");
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

