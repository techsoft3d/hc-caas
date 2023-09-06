const express = require('express');
const apiController = require('../controllers/api');
const router = express.Router();


router.get('/info', apiController.getInfo);
router.get('/status/:json?', apiController.getStatus);
router.get('/updated', apiController.getUpdated);

router.post('/upload', apiController.postFileUpload);
router.post('/uploadArray', apiController.postFileUploadArray);
router.get('/data/:itemid', apiController.getData);
router.get('/file/:itemid/:type', apiController.getFileByType);
router.get('/fileByName/:itemid/:name', apiController.getFileByName);
router.get('/original/:itemid', apiController.getOriginal);
router.put('/create/', apiController.putCreate);
router.put('/customImage/:itemid', apiController.putCustomImage);
router.put('/reconvert/:itemid', apiController.putReconvert);
router.put('/delete/:itemid', apiController.putDelete);
router.get('/items', apiController.getItems);

router.get('/custom', apiController.getCustom);
router.get('/uploadToken/:name/:size', apiController.getUploadToken);
router.get('/downloadToken/:itemid/:type', apiController.getDownloadToken);

router.get('/shattered/:itemid/:name', apiController.getShattered);
router.get('/shatteredXML/:itemid', apiController.getShatteredXML);

router.get('/streamingSession', apiController.getStreamingSession);
router.put('/enableStreamAccess/:sessionid', apiController.enableStreamAccess);

router.post('/addUser', apiController.addUser);
router.put('/generateAPIKey', apiController.generateAPIKey);
router.get('/checkPassword/:email/:password', apiController.checkPassword);
router.get('/userInfo/:email/:password', apiController.getUserInfo);
router.put('/changeOrgName/:email/:password/:orgid/:orgname', apiController.changeOrgName);
router.put('/updateOrgTokens/:orgid/:tokens', apiController.updateOrgTokens);
router.put('/updateOrgMaxStorage/:orgid/:maxstorage', apiController.updateOrgMaxStorage);
router.get('/retrieveInvite/:inviteid', apiController.retrieveInvite);
router.put('/acceptInvite/:inviteid/:password?', apiController.acceptInvite);
router.get('/getUsers/:email/:password/:orgid?', apiController.getUsers);
router.put('/removeUser/:targetemail/:orgid', apiController.removeUser);
router.put('/deleteUser/:targetemail', apiController.deleteUser);
router.put('/setSuperUser/:targetemail/:superuser', apiController.setSuperUser);
router.put('/addOrganization/:orgname', apiController.addOrganization);
router.post('/updateUser', apiController.updateUser);
router.get('/getOrganizations/:getAll?', apiController.getOrganizations);
router.get('/getOrganization/:orgid', apiController.getOrganization);
router.put('/switchOrganization/:orgid', apiController.switchOrganization);
router.get('/getAPIKeys', apiController.getAPIKeys);
router.put('/invalidateAPIKey/:key', apiController.invalidateAPIKey);
router.put('/editAPIKey/:key', apiController.editAPIKey);
router.get('/getStatsByMonth/:orgid/:month/:year', apiController.getStatsByMonth);
router.put('/injectStats/:orgid', apiController.injectStats);
router.put('/updatePassword', apiController.updatePassword);
router.get('/getFiles/:orgid', apiController.getFiles);
router.get('/getDataAuth/:itemid/:orgid', apiController.getDataAuth);
router.put('/deleteAuth/:orgid/:itemid', apiController.deleteAuth);
router.get('/getItemFromType/:orgid/:itemid/:type?', apiController.getItemFromType);
router.put('/deleteOrganization/:orgid', apiController.deleteOrganization);
router.put('/resetPassword/:targetemail', apiController.resetPassword);



module.exports = router;