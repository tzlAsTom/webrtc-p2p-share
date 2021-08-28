var express = require('express');
var router = express.Router();

const RoomManager = require('../models/RoomManager');

/* GET home page. */
router.get('/', function(req, res, next) {
    res.render('index', { title: 'Simple P2P Share', userId: req.session.userId});
});

router.post('/room/create', function(req, res, next){
  (async () => {
    let room = await RoomManager.create(req.session.userId);

    res.json({room, userId: req.session.userId});
  })().catch( (err) => {
    next(err);
  });
});

router.post('/room/join', function(req, res, next){
  //todo: apply && approve
  (async () => {
    let room = await RoomManager.join(req.session.userId, req.body.roomId);
    
    res.json({room, userId: req.session.userId});
  })().catch( (err) => {
    next(err);
  });
});

module.exports = router;
