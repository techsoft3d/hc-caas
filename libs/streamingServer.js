const fs = require('fs');
const config = require('config');
const del = require('del');
const Streamingserveritem = require('../models/streamingserveritem');
const Streamingsessionitem = require('../models/streamingsessionitem');
const Conversionitem = require('../models/conversionitem');
const fsPromises = fs.promises;
const path = require('path');


const localCache = require('./localCache');

const authorization = require('./authorization');


const decompress = require('decompress');

const execFile = require('child_process').execFile;

let tempFileDir = "";
const http = require('http');
var httpProxy = require('http-proxy');


let simStreamingSessions = 0;
var  maxStreamingSessions = 10;

var maxStreamingSessionsSoFar = 0;
var totalStreamingSessionsSoFar = 0;

var storage;

var serveraddress;

var startport = 4000;

var slots = [];


function findFreeSlot()
{
    for (let i=0;i<maxStreamingSessions;i++) {
        if (slots[i]) {
            slots[i] = false;
            return i;
        }
    }
    return -1;
}





function getScserverexepath(scserverpath) {

    if (process.platform == "win32") {
      return './ts3d_sc_server';
    }
    else {
      return  scserverpath + '/ts3d_sc_server';
    }
  }

  function getScserverpath(version) {

    let cp = config.get('hc-caas.streamingServer.scserverpath');
    if (!Array.isArray(cp)) {
       return cp;
    }

    if (!version || cp.length == 1) {
      return cp[0].path;
    }

    for (let i=0;i<cp.length;i++) {
      if (cp[i].version == version) {
        return cp[i].path;
      }
    }
    return "";
  }

exports.start = async () => {
    maxStreamingSessions = config.get('hc-caas.streamingServer.maxStreamingSessions');
    startport = config.get('hc-caas.streamingServer.startPort');

    for (let i=0;i<maxStreamingSessions;i++) {
        slots[i] = true;
    }
  
    tempFileDir = config.get('hc-caas.workingDirectory');
  
    storage = require('./permanentStorage').getStorage();

    serveraddress = global.caas_publicip + ":" + config.get('hc-caas.port');

    let streamingserver = await Streamingserveritem.findOne({ address: serveraddress });
    if (!streamingserver) {
        streamingserver = new Streamingserveritem({
            name: config.get('hc-caas.streamingServer.name'),
            address: serveraddress,
            freeStreamingSlots: maxStreamingSessions,
            region: config.get('hc-caas.region'),
            streamingRegion: config.get('hc-caas.streamingServer.streamingRegion'),
            renderType: config.get('hc-caas.streamingServer.renderType'),
            lastPing: new Date(),
            priority: config.get('hc-caas.streamingServer.priority'),
            pingFailed: false
        });
        streamingserver.save();
    }
    else {
        streamingserver.name = config.get('hc-caas.streamingServer.name');
        streamingserver.freeStreamingSlots = maxStreamingSessions;
        streamingserver.region = config.get('hc-caas.region');
        streamingserver.priority =  config.get('hc-caas.streamingServer.priority');
        streamingserver.streamingRegion =  config.get('hc-caas.streamingServer.streamingRegion');
        streamingserver.pingFailed = false;
        streamingserver.lastPing = new Date();
        streamingserver.save();
    }


    if (!fs.existsSync(tempFileDir)) {
        fs.mkdirSync(tempFileDir);
    }

    if (!fs.existsSync(tempFileDir + "/streamingtemp")) {
        fs.mkdirSync(tempFileDir + "/streamingtemp");
    }

    tempFileDir += "/streamingtemp";


    var proxy = new httpProxy.createProxyServer({
    });


    var proxyServer = http.createServer(function (req, res) {     
    });


    proxy.on('error', function (err, req, res) {
        console.log(err);
    });

    proxyServer.on('upgrade', async function (req, socket, head) {
        let s = req.url.split("=");

        let item;
        try {
            item = await Streamingsessionitem.findOne({ _id: s[1] });
        }
        catch (e) {
            console.log(e);
            return;
        }
        if (item && (item.slot != undefined)) {
            let port = item.slot + startport;
            try {
                proxy.ws(req, socket, head, { target: 'ws://127.0.0.1:' + port });
            }
            catch (e) {
                console.log("proxy issue:" + e);
            }
        }
    });

    proxyServer.listen(config.get('hc-caas.streamingServer.listenPort'));
    console.log('Streaming Server started');

};

exports.startStreamingServer = async (args) => {
    let slot = findFreeSlot();
    if (slot == -1)
    {      
        return {ERROR: "No free streaming slot"};
    }

    const item = new Streamingsessionitem({
        slot: slot,
        serveraddress: serveraddress,
      });

    let streamingLocation;
    if (args && args.startItem) {
        let citem = await authorization.getConversionItem(args.startItem, args,authorization.actionType.streamingAccess);
        if (citem && citem.streamingLocation) {
            item.streamingLocation = args.streamingLocation;
            streamingLocation = args.streamingLocation;
        }
    }
    await item.save();


    let sessiondir = tempFileDir + "/" + item.id;
    fs.mkdirSync(sessiondir);
    await runStreamingServer(slot, item.id, streamingLocation, args ? args.renderType : null, args ? args.version : null);

    let streamingserver = await Streamingserveritem.findOne({ address: serveraddress });
    streamingserver.freeStreamingSlots = maxStreamingSessions - simStreamingSessions;
    await streamingserver.save();

    let port;

    if (config.get('hc-caas.streamingServer.publicPort') != "") {
        port = config.get('hc-caas.streamingServer.publicPort');
    }
    else {    
        port = config.get('hc-caas.streamingServer.listenPort');
    }
    let address;

    if (config.get('hc-caas.streamingServer.publicURL') != "") {
        let split = config.get('hc-caas.streamingServer.publicURL').split(":");
        if (split.length == 3) {       
            port = config.get('hc-caas.streamingServer.publicURL').split(":")[2];
        }
        address = config.get('hc-caas.streamingServer.publicURL').replace(/(wss?:\/\/)/gi, '').split(":")[0];
    }
    else {           
        address = global.caas_publicip.replace(/(https?:\/\/)/gi, '').split(":")[0];
    }


    if (args && args.accessItems) {
        let accessResult = await this.serverEnableStreamAccess(item.id, args.accessItems, args);
        if (accessResult.ERROR) {
            return accessResult;
        }
    }

    return {serverurl:address, sessionid:item.id, port:port};

};


async function getZipFromStorage(item, sessionid) {
    if (localCache.isInCache(item.storageID)) {
        await localCache.readDirectory(item.storageID,tempFileDir + "/" + sessionid);
        return;
    }
    const data = await storage.readFile("conversiondata/" + item.storageID + "/" + item.name);
    const dir = tempFileDir + "/" + sessionid;
    await fsPromises.writeFile(dir + "/" + item.name, data);
    await decompress(dir + "/" + item.name, dir);
    await localCache.cacheZip(item.storageID,dir + "/" + item.name);
}


async function getFileFromStorage(item, sessionid, itemname, subdirectory) {

    if (localCache.isInCache(item.storageID,itemname)) {
        console.log("file loaded from cache");
        if (config.get('hc-caas.streamingServer.useSymLink')) {            
            const dir = tempFileDir + "/" + sessionid + subdirectory;
            await localCache.createSymLink(item.storageID,itemname, dir + "/" + itemname);
        }
        else {
            const data = await localCache.readFile(item.storageID,itemname);
            if (!data)
                return false;
            const dir = tempFileDir + "/" + sessionid + subdirectory;    
            await fsPromises.writeFile(dir + "/" + itemname, data);
        }
        return;
    }

    if (config.get('hc-caas.storage.type') == 'filesystem' && config.get('hc-caas.streamingServer.useSymLink')) {
        const dir = tempFileDir + "/" + sessionid + subdirectory;
        await storage.createSymLink("conversiondata/" + item.storageID + "/" + itemname, dir + "/" + itemname);
    }
    else {
        const data = await storage.readFile("conversiondata/" + item.storageID + "/" + itemname);
        if (!data)
            return false;
        const dir = tempFileDir + "/" + sessionid + subdirectory;

        await fsPromises.writeFile(dir + "/" + itemname, data);

        localCache.cacheFile(item.storageID,itemname,data);
    }
}
  
function someTimeout(to) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, to);
    });
}

exports.serverEnableStreamAccess = async (sessionid, storageIDs, args, hasNames = false) => {

    let session;

    try {
        session = await Streamingsessionitem.findOne({ _id: sessionid });
    }
    catch (e) {
        console.log(e);
        return { ERROR: "No session found" };
    }

    if (session && storageIDs) {

        let items;

        if (!hasNames) {
            items = await authorization.getConversionItem(storageIDs, args,authorization.actionType.streamingAccess);
        }
        else {
            items = await authorization.getConversionItem(storageIDs, args, authorization.actionType.streamingAccess,true);

        }

        if (!items) {
            return { ERROR: "No items found" };
        }

        let subdirectory = "";
        if (args && args.subDirectory) {
            fs.mkdirSync(tempFileDir + "/" + sessionid + "/" + args.subDirectory);
            subdirectory = "/" + args.subDirectory;
        }
    
        let storagePromises = [];
        for (let i = 0; i < storageIDs.length; i++) {
            let item = items[i];
            if (item) {
                console.log("Stream Access:" + item.name);
                if (item.streamLocation && item.streamLocation != "") {
                    let file = path.basename(item.streamLocation);
                    if (config.has('hc-caas.streamingServer.overrideStreamLocation')) {
                        await storage.createSymLinkDir(config.get('hc-caas.workingDirectory') + "/permanentStorage/conversiondata" + "/" + file, tempFileDir + "/" + sessionid + subdirectory + "/" + file);
                        continue;                        
                    }
                    else {
                        await storage.createSymLinkDir(item.streamLocation, tempFileDir + "/" + sessionid + subdirectory + "/" + file);
                        continue;
                    }
                }

                if (item.name.indexOf(".scz") != -1) {
                    item.files.push(item.name);
                }
                else if (item.name.indexOf(".zip" != -1) && item.startPath && item.startPath.indexOf(".scz") != -1) {
                    await getZipFromStorage(item, sessionid, item.name)
                }
                for (let j = 0; j < item.files.length; j++) {
                    if (item.files[j].indexOf(".scz") != -1) {
                        let itemname = item.files[j];
                        if (!fs.existsSync(tempFileDir + "/" + sessionid + subdirectory + "/" + itemname)) {
                            storagePromises.push(getFileFromStorage(item, sessionid,itemname, subdirectory));
                        }
                    }
                }
            }
        }
        await Promise.all(storagePromises);
        
        if (config.get('hc-caas.storage.type') == 'S3') {
       //     await someTimeout(300);
        }
        else {
            if (!config.get('hc-caas.streamingServer.useSymLink')) {
                await someTimeout(300);
            }
        }
        var endtime = new Date();
//        console.log("storage load time:" + (endtime - starttime));
        return { success: true };
    }
    else {    
        return { ERROR: "No session found" };
    }

};


async function runStreamingServer(slot,sessionid, streamingLocation, renderType, version) {
 
    simStreamingSessions++;
    totalStreamingSessionsSoFar++;
    if (maxStreamingSessionsSoFar < simStreamingSessions) {
        maxStreamingSessionsSoFar = simStreamingSessions;
    }    
    console.log("Streaming Session Started at " + new Date());
    console.log("Total sessions:" + totalStreamingSessionsSoFar + " Concurrent Sessions:" + simStreamingSessions +" Max Concurrent sessions:" + maxStreamingSessionsSoFar);
    let commandLine = setupCommandLine(slot + startport,sessionid, streamingLocation, renderType);
    let scserverpath = getScserverpath(version);

    execFile(getScserverexepath(scserverpath), commandLine, {
      cwd: scserverpath
    }, async function (err, data) {
        simStreamingSessions--;

        let streamingserver = await Streamingserveritem.findOne({ address: serveraddress });
        streamingserver.freeStreamingSlots = maxStreamingSessions - simStreamingSessions;
        await streamingserver.save();
    

        let item = await Streamingsessionitem.findOne({ _id:sessionid });
        await del(tempFileDir + "/" + item.id,{force: true});
        item.delete();
        slots[slot] = true;
        console.log("streaming session ended");
        if (err == null) {       
      }
      else {
        if (config.get("hc-caas.fullErrorReporting")) {
            console.error(err);
            console.error(data);
        }
        console.error("ERROR: Could not start streaming server. Check license and scserverpath path in config. Are required redistributables installed?");
      }
    });
    await someTimeout(500);    
  }

  
  function setupCommandLine(port, sessionid, streamingLocation, renderType) {

    let commandLine;

    let dirs = tempFileDir + "/" + sessionid;

    if (!path.isAbsolute(dirs)) {
        dirs = path.join(process.cwd(), dirs);
    }

    if (streamingLocation) {
        dirs += ";" + streamingLocation;
    }

    if (config.get('hc-caas.licenseFile') != "") {
        commandLine = ['--license-file', config.get('hc-caas.licenseFile')];
    }
    else {
        commandLine = ['--license', config.get('hc-caas.license')];
    }


    commandLine.push(
        '--id', "test123",
        '--initial-use-duration', '60',
        '--sc-port', port.toString(),
        '--model-search-directories', dirs
    );

    if (renderType == "server") {
        commandLine.push('--ssr', "1");
        if (config.get('hc-caas.streamingServer.useEGL')) {
            commandLine.push('--ssr-egl', "1");
        }
    }

    return commandLine;
}