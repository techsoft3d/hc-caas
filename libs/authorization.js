const User = require('../models/UserManagement/User');
const Organization = require('../models/UserManagement/Organization');
const APIKey = require('../models/UserManagement/ApiKey');
const Conversionitem = require('../models/conversionitem');
const config = require('config');
const bcrypt = require('bcrypt');


exports.getUserID = async (args) => {
    if (!config.get('hc-caas.requireAccessKey')) {
        return undefined;
    }
    if (!args || !args.accessKey) {
        return -1;
    }

    let key = await APIKey.findOne({ _id: args.accessKey });
    if (!key) {
        return -1;
    }
    return key.user;
}

exports.getConversionItem = async (itemid, args, useNames = false) => {
    let user = undefined;

    if (config.get('hc-caas.accessPassword') == "" || config.get('hc-caas.accesPassword') != args.accessPassword) {

        if (config.get('hc-caas.requireAccessKey')) {
            if (!args || !args.accessKey) {
                return null;
            }

            let key = await APIKey.findOne({ _id: args.accessKey });
            if (!key) {
                return null;
            }
            user = key.user;
        }
    }

    if (!Array.isArray(itemid)) {
        return await Conversionitem.findOne({ storageID: itemid, user: user });
    }
    else {
        if (useNames) {
            return await Conversionitem.find({ 'name': { $in: itemid }, user: user });
        }
        else {
            return await Conversionitem.find({ storageID: { $in: itemid }, user: user });
        }
    }
}



exports.addUser = async (req, args) => {

    let userid = await this.getUserID(args);
    if (userid == -1) {
        return { ERROR: "Not authorized" };
    }

    let user;
    if (userid) {
        user = await User.findOne({ id: userid });
        if (!user || user.role > 1) {
            return { ERROR: "Not authorized" };
        }
    }
    let password = await bcrypt.hash(req.body.password, 10);

    let org;

    if (req.body.organizationID && (!user || user.role == 0)) {
        org = await Organization.findOne({ id: req.body.organizationID });
    }
    else if (user && user.defaultOrganization) {
        org = await Organization.findOne({ id: user.defaultOrganization });
    }

    if (!org) {
        org = new Organization({
            name: "Temp"
        });
        await org.save();
    }

    const item = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        password: password,
        organizations: [{ id: org.id, role: 1, accepted: false }],
        defaultOrganization: org.id
    });


    await item.save();
    return { organizationID: org.id };
};


exports.generateAPIKey = async (req) => {

    let user = await User.findOne({email:req.params.email});
    if (!user) {
        return { ERROR: "User not found" };        
    }

    let result = await bcrypt.compare(req.params.password, user.password);
    if (!result) {
        return { ERROR: "wrong password" };        

    }

    await APIKey.deleteOne({ user: user.id });
    
    const item = new APIKey({
    user: user
   });
   await item.save();

   return {key:item.id};    
};


exports.checkPassword = async (req) => {

    let user = await User.findOne({email:req.params.email});
    if (!user) {
        return { ERROR: "User not found" };        
    }

    let result = await bcrypt.compare(req.params.password, user.password);
    if (!result) {
        return { ERROR: "wrong password" };        
    }

    return {success: true};
};