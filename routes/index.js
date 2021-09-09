var express = require('express');
var router = express.Router();

const RoomManager = require('../models/RoomManager');
const SessionManager = require('../models/SessionManager');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.redirect('/index.html');
});

router.get('/status', function(req, res, next){
  let room;
  let session = SessionManager.get(req.session.userId);
  if(session.roomId){
      room = RoomManager.get(session.roomId);
  }
  
  return res.json({
    userId: req.session.userId,
    room,
  });
});

router.post('/room/create', function(req, res, next){
  (async () => {
    let room = await RoomManager.create(req.session.userId);

    res.json({room, userId: req.session.userId});
  })().catch( (err) => {
    next(err);
  });
});

router.post('/room/apply', function(req, res, next){
  (async () => {
    let room = await RoomManager.apply(req.session.userId, req.body.roomId);
    
    res.json({result: 1});
  })().catch( (err) => {
    next(err);
  });
});

router.post('/room/leave', function(req, res, next){
  let session = SessionManager.get(req.session.userId);
  
  RoomManager.leave(session);
  
  res.json({});
});

module.exports = router;
