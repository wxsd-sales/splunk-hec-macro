// based on Tore's(tbjolset@cisco.com)DataDog macro
// modified by Harish (hachawla@cisco.com) and Taylor (tahanson@cisco.com)
// tested only on Deskpro RoomOS and MTR

import xapi from 'xapi';


const SPLK_TKN2 = `Authorization: Splunk 1d365f50-3812-49bb-b83f-fe5af2aa1212`;
const SPLK_URL2 = `https://splunk.cumulusorg.com:8443/services/collector/raw`
const SPLK_TAGS = 'env:dcloud,team:coe_dev';  // comma delimited set of tags to be added to all health data captured by this macro

const CHECK_IF_CALL_FREQUENCY = 60000; // Interval at which script checks for active call; recommended not to change this.

// configure the check frequency and status commands to run during calls
const IN_CALL_CHECK_FREQUENCY = 60000; // one minute by default; NOTE: must be larger (in seconds) than the number of STATUS_LIST commands + the number of peripherals connected to the roomkit.
const IN_CALL_STATUS_COMMAND_LIST = [
  'call',
  'mediachannels call',
  'roomanalytics'
];

// configure the check frequency and status commands to run all the time, regardless of whether the room kit device is in a call
const GENERAL_CHECK_FREQUENCY = 300000; // 5 minutes by default; NOTE: must be larger (in seconds) than the number of STATUS_LIST commands + the number of peripherals connected to the roomkit.
const GENERAL_STATUS_COMMAND_LIST = [
  'network'
];
const MONITOR_PERIPHERALS = false;  // perhipherals monitoring requires extra logic and processing

var callbackNumber = "";

var tags = '';
const version = 'version:0.2.0';
if (SPLK_TAGS) {
  tags = `${version},${SPLK_TAGS}`;
}
// var next_in_call_check_interval = IN_CALL_CHECK_FREQUENCY;
// var next_general_check_interval = GENERAL_CHECK_FREQUENCY;

const CONTENT_TYPE = "Content-Type: application/json";
var systemInfo = {
    softwareVersion : ''
    , softwareReleaseDate : ''
    , systemMode : ''
    , systemSerialNumber : ''
    , systemProductId : ''
};


// structuring and sending data

function replaceNumbers(key, value) {
  // need to format numbers in json without quotes
  if (isNaN(value)) {
    return value;
  }
  return parseFloat(value);
}

function formatHealthResults(message, command){
  try{
  var data_type = Object.prototype.toString.call(message);

  if (data_type === 'undefined') {
    console.log(`something not rite`);
  }

  if (data_type === '[object String]') {
    message = {'value': message};
    console.log(`String message: ${message}`);
  } else if ((data_type === '[object Array]') && message.length === 1) {
    message = message[0];
    console.log(`Array message: ${message}`);
  }
  try{
  if (Object.keys(message).length === 0) {
    var message = {'command_response': 'none'};
  } else if(command == 'call'){
    callbackNumber = message['CallbackNumber'];
  } else if (command == 'mediachannels call'){
    var namespace = '';
    for (let i = 0; i < message['Channel'].length; i++) {
      try {
      if (message['Channel'][i]['Type'] in message['Channel'][i]) {
        namespace = [
          message['Channel'][i]['Type'],
          message['Channel'][i][message['Channel'][i]['Type']]['ChannelRole'],
          message['Channel'][i]['Direction']
        ].join('_');
        console.log('namespace 1 is - '+ namespace);
        console.log(`netstat 1 ${message['Channel'][i]['Netstat']}`);
        console.log(`channeltype ${message['Channel'][i]['Type']}`);
        console.log(message[namespace]);
        message[namespace] = Object.assign(
          message['Channel'][i]['Netstat'],
          message['Channel'][i][message['Channel'][i]['Type']]
        );
        console.log(message[namespace]);
      } else {
        namespace = [
          message['Channel'][i]['Type'],
          message['Channel'][i]['Direction']
        ].join('_');
        console.log('namespace 2 is - '+ namespace);
        console.log(`netstat 2 ${message['Channel'][i]['Netstat']}`);
        message[namespace] = Object.assign(
          message['Channel'][i]['Netstat']
        );
        console.log(message[namespace]);
      }
      } catch (c_error){
        console.log (`channel error block ${c_error}`);
      }
    }
  }
  } catch (mc_error){
    console.log (`media channel error block ${mc_error}`);
  }

  message["CallbackNumber"] = callbackNumber;

  return {
    'telemetry_source': 'Cisco Video Endpoint',
    'tagging': tags,
    'system_info': systemInfo,
    'device_data': message,
    'command': command
  }
  } catch (gf_error){
    console.log (`general formatting error block ${gf_error}`);
  }
}

function sendHealthData(message){
  console.log('Message sendHealthData: ' + JSON.stringify(message, replaceNumbers));
  xapi.command('HttpClient Post', { 'Header': [CONTENT_TYPE, SPLK_TKN2] , 'Url':SPLK_URL2, 'AllowInsecureHTTPS': 'True'}, JSON.stringify(message, replaceNumbers))
  .catch(e=>{console.log(`second URL xapi command error ${e}`)});
}

function checkStatus(statusList){
  // we schedule the sending of data in 1s increments so as to avoid running out of HttpClient handlers on the device
  for (let i = 0; i < statusList.length; i++) {
    setTimeout(() => xapi.status.get(statusList[i]).then((stat) => {
      sendHealthData(formatHealthResults(stat, statusList[i]));
    }).catch(e=>{console.log(`xapi status list error ${e}`)}), i*1000);
  }
}

function getSystemData(){
  xapi.status.get('SystemUnit Software Version').then((value) => {
    systemInfo.softwareVersion = value;
  }).catch(e=>{console.log(`xapi sw version error ${e}`)});
  xapi.status.get('SystemUnit Software ReleaseDate').then((value) => {
    systemInfo.softwareReleaseDate = value;
  }).catch(e=>{console.log(`xapi sw release error ${e}`)});
  xapi.status.get('SystemUnit ProductId').then((value) => {
    systemInfo.systemProductId = value;
  }).catch(e=>{console.log(`xapi systemProductId error ${e}`)});
  xapi.status.get('SystemUnit Hardware Module SerialNumber').then((value) => {
    systemInfo.systemSerialNumber = value;
  }).catch(e=>{console.log(`xapi systemSerialNumber error ${e}`)});
  xapi.status.get('MicrosoftTeams').then((value)=>{
    console.log(`MSFT data: ${value}`);
    if (value.User && value.User.SignedIn){
        console.log (`Device in MTR mode ${value.User.SignedIn}`);
        systemInfo.systemMode = 'MTR';
    } else {
        console.log (`Device in RoomOS mode`);
        systemInfo.systemMode = 'RoomOS';
    }
  }).catch(e=>{console.log(`xapi msft command error ${e}`)});
}

function runInCallStatusCheck() {
  checkStatus(IN_CALL_STATUS_COMMAND_LIST);
}

function runGeneralStatusCheck() {
  checkStatus(GENERAL_STATUS_COMMAND_LIST);
  if (MONITOR_PERIPHERALS) {
    xapi.command('peripherals list').then((perifs) => { getEachPeripheralData(perifs); })
    .catch(e=>{console.log(`xapi gen status chk error ${e}`)});
  }
}


// scheduling

function scheduleStatusChecks(countdown_general, countdown_in_call, calls) {
  if (calls.length < 1) {
    countdown_in_call = 0;
  } else {
    countdown_in_call -= CHECK_IF_CALL_FREQUENCY;
    if (countdown_in_call <= 0) {
      setTimeout(() => runInCallStatusCheck(), 1);
      countdown_in_call = IN_CALL_CHECK_FREQUENCY;
    }
  }
  countdown_general -= CHECK_IF_CALL_FREQUENCY;
  if (countdown_general <= 0) {
    setTimeout(() => runGeneralStatusCheck(), countdown_in_call > 0 ? 1 : (IN_CALL_STATUS_COMMAND_LIST.length + 1) * 1000);
    countdown_general = GENERAL_CHECK_FREQUENCY;
  }
  setTimeout(() => xapi.status.get('call').then((res) => {
    scheduleStatusChecks(countdown_general, countdown_in_call, res);
  }).catch(e=>{console.log(`xapi call status error ${e}`)}), CHECK_IF_CALL_FREQUENCY);
}


function monitorRoomKit() {
  getSystemData();
  console.log("got system data, now schedule status checks")
  xapi.status.get('call').then((res) => {
    scheduleStatusChecks(GENERAL_CHECK_FREQUENCY, 0, res);
  }).catch(e=>{console.log(`xapi schedule chk error ${e}`)});
}

monitorRoomKit();