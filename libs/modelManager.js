const config = require('config');
const Conversionitem = require('../models/conversionitem');
const Streamingserveritem = require('../models/streamingserveritem');
const User = require('../models/UserManagement/User');

const fs = require('fs');
const conversionQueue = require('./conversionServer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const Queueserveritem = require('../models/queueserveritem');
const fetch = require('node-fetch');

const localCache = require('./localCache');

const authorization = require('./authorization');
const APIKey = require('../models/UserManagement/ApiKey');



var storage;

let lastUpdated  = new Date();

var totalConversions = 0;

var customCallback;
var conversionPriorityCallback;


function getFileSize(itempath) {
  return new Promise((resolve, reject) => {
    fs.stat(itempath, (err, stats) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(stats.size);
      }
    });
  });
}


async function purgeFiles() {
  let files = await Conversionitem.find();

  for (let i = 0; i < files.length; i++) {
    if (files[i].conversionState != "SUCCESS") {
      let timeDiff = Math.abs(new Date() - files[i].updated);
      let diffHours = Math.ceil(timeDiff / (1000 * 60 * 60));
      if (diffHours > 24) {
        exports.deleteConversionitem2(files[i]);
      }
    }
  }
}

async function refreshServerAvailability() {
  var queueservers = await Queueserveritem.find();

  for (let i = 0; i < queueservers.length; i++) {
    const controller = new AbortController();
    let to = setTimeout(() => controller.abort(), 2000);

    try {
      let queserverip = queueservers[i].address;
      if (queserverip.indexOf(global.caas_publicip) != -1) {
        queserverip = "localhost" + ":" + config.get('hc-caas.port');
      }

      let res = await fetch("http://" + queserverip + '/caas_api/pingQueue', { signal: controller.signal, 
        headers: { 'CS-API-Arg': JSON.stringify({accessPassword:config.get('hc-caas.accessPassword') }) } });
      if (res.status == 404) {
        throw "Could not ping Conversion Server " + queueservers[i].address;
      }
      else {
        console.log("Conversion Server found:" + queueservers[i].address);
        queueservers[i].lastPing = new Date();
        queueservers[i].pingFailed = false;
        queueservers[i].save();
      }
    }
    catch (e) {
      let timeDiff = Math.abs(new Date() - queueservers[i].lastPing);
      queueservers[i].pingFailed = true;
      queueservers[i].save();
      let diffHours = Math.ceil(timeDiff / (1000 * 60 * 60));
      if (diffHours > 24) {
        await Queueserveritem.deleteOne({ "address": queueservers[i].address });
        console.log("Conversion Server " + queueservers[i].address + " not reachable for more than 24 hours. Removed from database");
      }
      else {
        console.log("Could not ping Conversion Server " + queueservers[i].address + ": " + e);
      }
    }
    clearTimeout(to);
  }
}

exports.setCustomCallback = (customCallback_in) => {
  customCallback = customCallback_in;
}

exports.start = async (conversionPriorityCallback_in) => {
  conversionPriorityCallback = conversionPriorityCallback_in;
 
  storage = require('./permanentStorage').getStorage();

  setTimeout(async function () {
    await refreshServerAvailability();
  }, 1000);

  setInterval(async function () {
    await refreshServerAvailability();
  }, 1000 * 60 * 60);


  if (config.get('hc-caas.modelManager.purgeFiles')) {
    await purgeFiles();
    setInterval(async function () {
      await purgeFiles();
    }, 1000 * 60 * 60 * 24);
  }


  console.log('Model Manager started');
};


exports.getDataFromItem = async (item) => {
  let returnItem = JSON.parse(JSON.stringify(item));

  returnItem.__v = undefined;
  returnItem._id = undefined;

  returnItem.storageAvailability = undefined;
  returnItem.webhook = undefined;

  if (item.apiKey) {
    let key = await APIKey.findOne({ _id: item.apiKey });
    if (key) {
      returnItem.accessKey = key.name;
    }
    returnItem.apiKey = undefined;
  }

  if (item.user) {
    let user = await User.findOne({ _id: item.user });
    if (user) {
      returnItem.user = user.email;
    }
  }
  return returnItem;
};

exports.getData = async (storageID, args) => {


  let storageIDs;
  if (args && args.storageIDs) {
    storageIDs = args.storageIDs;
  }
  else {
    storageIDs = [storageID];
  }

  if (storageIDs.length == 1) {
    let item = await authorization.getConversionItem(storageIDs[0], args,authorization.actionType.info);

    if (item) {
      return await this.getDataFromItem(item);     
    } else {
      return { ERROR: "Item not found" };
    }
  } else {
    let items = await authorization.getConversionItem(storageIDs, args,args,authorization.actionType.info);
    if (items.length > 0) {
      let returnItems = items.map((item) => {
        let returnItem = JSON.parse(JSON.stringify(item));
        returnItem.__v = undefined;
        returnItem._id = undefined;
        returnItem.user = undefined;
        returnItem.storageAvailability = undefined;
        returnItem.webhook = undefined;
        return returnItem;
      });
      return returnItems;
    } else {
      return { ERROR: "Items not found" };
    }
  }
};

exports.requestDownloadToken = async (storageID, type, args) => {
  if (!storage.requestDownloadToken) {
    return { ERROR: "Not available for this storage type" };
  }
  let item = await authorization.getConversionItem(storageID, args);

  if (item) {
    let token;
    if (type == "scs" && item.name.indexOf(".scs") != -1) {
      token = await storage.requestDownloadToken("conversiondata/" + item.storageID + "/" + item.name, item);
    }
    else {
      token = await storage.requestDownloadToken("conversiondata/" + item.storageID + "/" + item.name + "." + type, item);
    }
    return { token: token, storageID: storageID };
  }
  else {
    return { ERROR: "Item not found" };
  }
};

async function readFileWithCache(storageID, name, item) {
  if (name.indexOf(".scs") != -1) {
    if (localCache.isInCache(storageID, name)) {
      console.log("file loaded from cache");
      const data = await localCache.readFile(storageID, name);
      return data;
    }
    else {
      const data = await storage.readFile("conversiondata/" + storageID + "/" + name, item);
      if (!data) {
        return null;
      }
      localCache.cacheFile(storageID, name, data);
      return data;
    }
  }
  else {
    return await storage.readFile("conversiondata/" + storageID + "/" + name, item);
  }
}


exports.getFromItem  = async (item,type) => {
  let blob;

  try {
  if (!type || item.name.indexOf("." + type) != -1) {
    blob = await readFileWithCache(item.storageID,item.name, item);
  }
  else {
    blob = await readFileWithCache(item.storageID,item.name + "." + type, item);
  }
  }
  catch (e) {
    return { ERROR: "File not found" };
  }
  if (!blob) {
    return { ERROR: "File not found" };
  }
  else {
    return ({data:blob});
  }
}


exports.get = async (storageID,type,args) => {
  let item = await authorization.getConversionItem(storageID, args);
  if (item) {
    return await this.getFromItem(item,type);
  }
  else
  {
    return {ERROR: "Item not found"};
  }
};


exports.getByName = async (storageID, name, args) => {
  let item = await authorization.getConversionItem(storageID, args);
  if (item) {
    try {
      let blob = await storage.readFile("conversiondata/" + item.storageID + "/" + name);
      return ({ data: blob });
    }
    catch (e) {
      return { ERROR: "File not found" };
    }
  }
  else {
    return { ERROR: "Item not found" };
  }
};

exports.getShattered = async (storageID, name,args) => {
  let item = await authorization.getConversionItem(storageID, args);
  if (item) {
    let blob = await storage.readFile("conversiondata/" + item.storageID + "/scs/" + name);
    return ({ data: blob });
  }
  else {
    return { ERROR: "Item not found" };
  }
};

exports.getShatteredXML = async (storageID,args) => {
  let item = await authorization.getConversionItem(storageID, args);
  if (item) {
    let blob = await storage.readFile("conversiondata/" + item.storageID + "/shattered.xml");
    return ({ data: blob });
  }
  else {
    return { ERROR: "Item not found" };
  }
};


exports.getOriginal = async (storageID, args) => {
  let item = await authorization.getConversionItem(storageID, args);
  if (item) {
    let blob = await storage.readFile("conversiondata/" + item.storageID + "/" + item.name);
    return ({ data: blob });
  }
  else {
    return { ERROR: "Item not found" };
  }
};


exports.appendFromBuffer = async (buffer, itemname, storageID) => {
  let item = await Conversionitem.findOne({ storageID: storageID });
  if (item) {
    await storage.storeFromBuffer(buffer, "conversiondata/" + storageID + "/" + itemname, item);
    let newfile = true;
    for (let i = 0; i < item.files.length; i++) {
      if (item.files[i] == itemname) {
        newfile = false;
        break;
      }
    }
    if (newfile) {
      item.files.push(itemname);
    }
    item.updated = new Date();
    await item.save();
    return { storageID: storageID };
  }
  else {
    return { ERROR: "Item not found" };
  }
};

exports.append = async (directory, itemname, storageID, args) => {
  let item = await authorization.getConversionItem(storageID, args, authorization.actionType.other);
  if (item) {
    let isize;
    if (directory) {
      if (!args.multiConvert) {
        isize = await getFileSize(directory + "/" + itemname);
      }
      let res = await storage.store(directory + "/" + itemname, "conversiondata/" + storageID + "/" + itemname, item);
      if (res.ERROR) {
        return res;
      }
    }
    else {
      isize = args.size;
    }
    if (!item.size) {
      item.size = 0;
    }

    if (isize != undefined) {
      item.size += isize;
      await authorization.updateStorage(item, isize);
    }

    let newfile = true;
    for (let i = 0; i < item.files.length; i++) {
      if (item.files[i] == itemname) {
        newfile = false;
        break;
      }
    }
    if (newfile) {
      item.files.push(itemname);
    }
    item.updated = new Date();
    await item.save();

    if (directory) {
      fs.rm(directory, { recursive: true }, (err) => {
        if (err) {
          throw err;
        }
      });
    }

    return { storageID: storageID };
  }
  else {
    return { ERROR: "Item not found" };
  }
};

exports.requestUploadToken = async (itemname,size, args) => {

  let user = await authorization.getUser(args, true);

  if (user == -1) {
    return { ERROR: "Not authorized to upload" };
  }

  let storageID;
  if (!storage.requestUploadToken) {
    return { ERROR: "Not available for this storage type" };
  }

  if (args && args.storageID != undefined) {
    args.size = size;
    let data = await this.append(null, itemname, args.storageID,args);
    storageID = args.storageID;
  }
  else {

    storageID = uuidv4();

    let startState = "UPLOADING";
    const item = new Conversionitem({
      name: itemname,
      storageID: storageID,
      conversionState: startState,
      updated: new Date(),
      created: new Date(),
      webhook: args.webhook,
      hcVersion: args.hcVersion,
      storageAvailability: storage.resolveInitialAvailability(),
      user: user,
      size: size,
      apiKey: (args.accessKey && args.accessKey != "") ? args.accessKey : undefined,
      organization: (user && user.defaultOrganization) ? user.defaultOrganization : undefined

    });
    item.save();
    await authorization.updateStorage(item, size);
  }

  let token = await storage.requestUploadToken("conversiondata/" + storageID + "/" + itemname);
  return { token: token, storageID: storageID };
};


exports.createMultiple = async (files, args) => {

  let skipConversion = false;
  if (args.skipConversion) {
    skipConversion = true;
  }
  args.skipConversion = true;
  args.multiConvert = true;

  let rootFileIndex = 0;
  if (args.rootFile) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].originalname == args.rootFile) {
        rootFileIndex = i;
        break;
      }
    }
  }

  let item = await this.createDatabaseEntry(files[rootFileIndex].originalname, args);
  if (!item) {
    return { ERROR: "Can't Upload. Not authorized" };
  }
  await this.create(item, files[rootFileIndex].destination, files[rootFileIndex].originalname, args);
  let storageID = item.storageID;
  let proms= [];
  let totalsize = 0;
  for (let i = 0; i < files.length; i++) {
    if (rootFileIndex == i) {
      continue;
    }
    totalsize += await getFileSize(files[i].destination + "/" + files[i].originalname);
    proms.push(this.append(files[i].destination, files[i].originalname, storageID,args));
  }

  await Promise.all(proms);
  item.size += totalsize;
  await item.save();
  await authorization.updateStorage(item,totalsize);

  if (!skipConversion) {
    await this.reconvert(storageID, args);
  }
  return { storageID: storageID };
};



exports.createDatabaseEntry = async (itemname, args) => {

  let storageID = uuidv4();
  let startState = "PENDING";
  let user = await authorization.getUser(args, true);

  if (user == -1) {
    return null;
  }


  if (args.skipConversion)
    startState = "SUCCESS";
  const item = new Conversionitem({
    name: itemname,
    storageID: storageID,
    startPath: args.startPath,
    conversionState: startState,
    shattered: args.processShattered,
    updated: new Date(),
    created: new Date(),
    webhook: args.webhook,
    hcVersion: args.hcVersion,
    size: args.size,
    conversionCommandLine: args.conversionCommandLine,
    storageAvailability: storage.resolveInitialAvailability(),
    apiKey: (args.accessKey && args.accessKey != "") ? args.accessKey : undefined,
    user: user,
    organization: (user && user.defaultOrganization) ? user.defaultOrganization : undefined


  });
  await item.save();
  return item;
};



exports.convertSingle = async (inpath,outpath,type, inargs) => {

  let args = {};
  if (inargs) {
    args = inargs;
  }
 
  let filename = path.basename(inpath);
  let item = await this.createDatabaseEntry(filename, args);

  try {
    await storage.store(inpath, "conversiondata/" + item.storageID + "/" + filename);
  }
  catch (err) {
    this.deleteConversionitem(item.storageID,args);
    return err;
  }    
  sendConversionRequest({ item: item });
  await waitUntilConversionDone(item.storageID);
  
  let res = await this.get(item.storageID,type);
  
  this.deleteConversionitem(item.storageID,args);
  
  if (res.ERROR) {
    return res;
  }
  else {
    if (outpath) {
      fs.writeFileSync(outpath, res.data);
    }
    return { storageID: item.storageID, buffer:res.data};
  }
};


exports.create = async (item, directory, itemname, args) => {
 
  item.size = await getFileSize(directory + "/" + itemname);
  await item.save();
  await authorization.updateStorage(item,item.size);

  await storage.store(directory + "/" + itemname, "conversiondata/" + item.storageID + "/" + itemname);

  if (await authorization.conversionAllowed(args)) {
    if (!args.skipConversion) {
      await sendConversionRequest({ item: item });

      if (args.waitUntilConversionDone) {
        await waitUntilConversionDone(item.storageID);
      }
    }
  }

  fs.rm(directory, { recursive: true }, (err) => {
    if (err) {
      throw err;
    }
  });
  console.log("File Uploaded:" + itemname);

};


exports.createEmpty = async (args) => {
  let user = await authorization.getUser(args, true);

  if (user == -1) {
    return { ERROR: "Not authorized to upload" };
  }

  var storageID = uuidv4();

  let startState = "PENDING";
  if (args.skipConversion) {
    startState = "SUCCESS";
  }
  const item = new Conversionitem({
    name: args.itemname,
    storageID: storageID,
    startPath: args.startPath,
    conversionState: startState,
    shattered: args.processShattered,
    updated: new Date(),
    created: new Date(),
    webhook: args.webhook,
    hcVersion: args.hcVersion,
    streamLocation:"",
    conversionCommandLine: args.conversionCommandLine,
    storageAvailability: storage.resolveInitialAvailability(),
    apiKey: (args.accessKey && args.accessKey != "") ? args.accessKey : undefined,
    user: user,
    organization: (user && user.defaultOrganization) ? user.defaultOrganization : undefined
  });
  
  await item.save();

  return { storageID: storageID };
};



exports.generateCustomImage = async (storageID, args) => {

  if (!storageID)
  {
    return {ERROR: "storageID not specified"};
  }
  let item = await authorization.getConversionItem(storageID, args,authorization.actionType.other);

  if (item) {
    item.conversionState = "PENDING";
    
    if (args.conversionCommandLine)
    {
      item.conversionCommandLine = args.conversionCommandLine;
    }
   
    item.updated = new Date();
    await item.save();
    await sendConversionRequest({ item: item, customImageCode: args.customImageCode });
    return {SUCCESS: true};
  }
  else {
    return {ERROR: "Item not found"};
  }
};


exports.reconvert = async (storageID, args) => {

  if (!storageID)
  {
    return {ERROR: "storageID not specified"};
  }
  let item = await authorization.getConversionItem(storageID, args,authorization.actionType.other);


  if (item) {
    item.conversionState = "PENDING";

    if (!await authorization.conversionAllowed(args)) {
      return { ERROR: "Not authorized" };
    }

    if (args.multiConvert) {
      item.multiConvert = true;
    }

    if (args.startPath)
    {
      item.startPath = args.startPath;
    }
    if (args.conversionCommandLine)
    {
      item.conversionCommandLine = args.conversionCommandLine;
    }
    if (args.processShattered)
    {
      item.shattered = args.processShattered;
    }
    if (args.hcVersion) {
      item.hcVersion = args.hcVersion;
    }

    item.updated = new Date();
    await item.save();
    
    if (args.overrideItem) {
      item.name = args.overrideItem;
    }
    
    sendConversionRequest({ item: item });

    if (args.waitUntilConversionDone) {
      await waitUntilConversionDone(storageID);
      totalConversions++;
      console.log("File " + item.name + " with storageID " + storageID + " converted at " + new Date());   
      console.log("Total Conversions:" + totalConversions);
    }
    return {SUCCESS: true};
  }
  else {
    return {ERROR: "Item not found"};
  }
};

function waitUntilConversionDone(storageID) {
  return new Promise((resolve, reject) => {
    let waitInterval = setInterval(async () => {
      let item = await Conversionitem.findOne({ storageID: storageID });
      if (item.conversionState == "SUCCESS" || item.conversionState.indexOf("ERROR") != -1) {
        clearInterval(waitInterval);
        resolve();
      }
    }, 1000);
  });
}



exports.deleteConversionitem2 = async (item) => {

    if (item.size != undefined) {
        await authorization.updateStorage(item,-item.size);
    }
    let storageID = item.storageID;
    console.log("Deleting item: " + storageID + " " + item.name);
    storage.delete("conversiondata/" + item.storageID, item);
    lastUpdated = new Date();
    await Conversionitem.deleteOne({ storageID: storageID }); 
};


exports.deleteConversionitem = async (storageID, args) => {

  let item = await authorization.getConversionItem(storageID, args, authorization.actionType.other);
  if (item) {
    await this.deleteConversionitem2(item);
    authorization.updateStorage(args,-item.size);
  }
  else {
    return {ERROR: "Item not found"};
  }
};

async function sendConversionRequest(payload) {

  let queueservers = await Queueserveritem.find({ region: config.get('hc-caas.region') });
  
  queueservers.sort(function (a, b) {
    return  a.pingFailed - b.pingFailed || b.priority - a.priority || b.freeConversionSlots - a.freeConversionSlots;

  });

  if (conversionPriorityCallback) {
    let cResult =  conversionPriorityCallback(queueservers, payload);
    if (cResult) {
      queueservers = cResult.servers;
      payload.name = cResult.name;
    }
  }

  conversionQueue.getQueue().add(payload);

  if (queueservers && queueservers.length > 0) {
    for (let i = 0; i < queueservers.length; i++) {
      const controller = new AbortController();
      let to = setTimeout(() => controller.abort(), 2000);
      
      if (queueservers[i].freeConversionSlots > 0) {
        try {
          let queserverip = queueservers[i].address;
          if (queserverip.indexOf(global.caas_publicip) != -1) {
            queserverip = "localhost" + ":" + config.get('hc-caas.port');
          }

          let res = await fetch("http://" + queserverip + '/caas_api/startConversion', { method: 'PUT',signal: controller.signal,
          headers: { 'CS-API-Arg': JSON.stringify({accessPassword:config.get('hc-caas.accessPassword') }) } });
          if (res.status == 404) {
            throw 'Conversion Server not found';
          }
        }
        catch (e) {
          console.log("Error sending conversion request to " + queueservers[0].address + ": " + e);
          queueservers[i].pingFailed = true;
          queueservers[i].save();
          continue;
        }
        queueservers[i].lastPing = new Date();
        queueservers[i].pingFailed = false;
        queueservers[i].save();
        break;
      }
      clearTimeout(to);
    }
  }
}


exports.getItems = async (args, organization = undefined) => {

  let models;
  if (!organization) {
    let user = await authorization.getUser(args,true);

    if (user == -1) {
      return { ERROR: "Not authorized" };
    }  
    if (user) {
      models = await Conversionitem.find({ organization:  user.defaultOrganization });
    }
    else {
      models = await Conversionitem.find();
    }
  }
  else {
    models = await Conversionitem.find({ organization: organization });
  }

  let cleanedModels = [];

  let userhash = [];
  let accessKeyHash = [];
  for (let i = 0; i < models.length; i++) {
    let returnItem = JSON.parse(JSON.stringify(models[i]));
    returnItem.__v = undefined;
    returnItem._id = undefined;

    if (returnItem.apiKey) {
      if (!accessKeyHash[returnItem.apiKey]) {
        let key = await APIKey.findOne({ _id: returnItem.apiKey });
        if (key) {
          accessKeyHash[returnItem.apiKey] = key.name;
        }
        else {  
          accessKeyHash[returnItem.apiKey] = undefined;
        }
      }      
      returnItem.accessKey = accessKeyHash[returnItem.apiKey];
      returnItem.apiKey = undefined;
    }

    if (returnItem.user) {
      if (!userhash[returnItem.user]) {
        let user = await User.findOne({ _id: returnItem.user });
        if (user) {
          userhash[returnItem.user] = user.email;
        }
        else {  
          userhash[returnItem.user] = undefined;
        }
      }      
      returnItem.user = userhash[returnItem.user];
           
    }
    cleanedModels.push(returnItem);
  }
  return { "itemarray": cleanedModels };
};


exports.getLastUpdated = async () => {
  let lastUpdatedRecord = await Conversionitem.findOne().sort({updated: -1});
  if (lastUpdatedRecord && lastUpdatedRecord.updated > lastUpdated)
  {
    return {"lastUpdated":lastUpdatedRecord.updated};
  }
  else
  {
    return {"lastUpdated":lastUpdated};
  }
};


exports.executeCustom = async (args) => {


  let resArray = [];
  if (args.sendToAll) {
    let queueservers = await Queueserveritem.find();
    let streamServers = await Streamingserveritem.find();
    let allServers = queueservers.concat(streamServers);


    let addressHash = [];

    for (let i = 0; i < allServers.length; i++) {
      const controller = new AbortController();
      let to = setTimeout(() => controller.abort(), 2000);

      try {
        if (addressHash[allServers[i].address]) {
          continue;
        }
        addressHash[allServers[i].address] = true;

        let queserverip = allServers[i].address;
        if (queserverip.indexOf(global.caas_publicip) != -1) {
           continue;
        }

        let res = await fetch("http://" + queserverip + '/caas_api/customCallback', {
          method: 'PUT', signal: controller.signal,
          headers: { 'CS-API-Arg': JSON.stringify({ accessPassword: config.get('hc-caas.accessPassword'), callbackData: args.callbackData }) }
        });
        if (res.status == 404) {
          throw "Could not ping Server " + allServers[i].address;
        }
        else {
          resArray.push({ address: allServers[i].name, result: await res.json() });
        }
      }
      catch (e) {
      }
      clearTimeout(to);
    }
  }

  if (customCallback)
  {
     resArray.push({address:"", result: await customCallback(args.callbackData)});
  }
  return { "results": resArray };
  
}