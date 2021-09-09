'use strict';

const IdGenerator = require('./IdGenerator');
const SessionManager = require('./SessionManager');

let RoomManager = module.exports;

/*
 * roomId:
 *   {roomId, ownerId, guestIdList:[]}
 */
let ROOM_HASH = {};
RoomManager.create = async (userId) => {
  let session = SessionManager.get(userId);
  if(session.roomId){
    RoomManager.leave(session);
  }
  
  let roomId = await IdGenerator.next('room');
  let room = {
    roomId,
    ownerId: session.userId,
    guestIdList: [],
  };
  ROOM_HASH[roomId] = room;
  session.roomId = roomId;
  return room;
};

RoomManager.get = (roomId) => {
  return ROOM_HASH[roomId];
};

//todo: firefox request twice
RoomManager.apply = async (userId, roomId) => {
  let session = SessionManager.get(userId);
  if(session.roomId){
    RoomManager.leave(session);
  }

  let room = ROOM_HASH[roomId];
  if(!room) throw Error('room not found:' + roomId);
  
  let ownerId = room.ownerId;
  SessionManager.sendPushMessage(ownerId, {
    type: 'room.applyRequest',
    data: {
      roomId: roomId,
      applyUserId: userId,
      timeStampMs: Date.now(),
    },
  });
};


RoomManager.join = async (userId, roomId) => {
  let session = SessionManager.get(userId);
  if(session.roomId){
    RoomManager.leave(session);
  }
  
  let room = ROOM_HASH[roomId];
  if(!room) throw Error('room not found:' + roomId);
  
  room.guestIdList.push(userId);
  session.roomId = roomId;
  RoomManager.publishMessage(room, {type: 'room.update', data: {
    type: 'join',
    userId: userId,
    room,
  }});
  
  return room;  
};


RoomManager.leave = (session) => {
  let userId = session.userId;
  let roomId = session.roomId;
  if(!roomId) return;
  
  session.roomId = undefined;
  
  let room = ROOM_HASH[roomId];
  if(!room) return;
  
  if(userId == room.ownerId){
    let tmp = room.guestIdList.splice(0, 1);
    room.ownerId = tmp[0];
  }else{
    let index = room.guestIdList.indexOf(userId);
    if(index != -1){
      room.guestIdList.splice(index, 1);
    }
  }
  
  if(!room.ownerId){
    delete ROOM_HASH[roomId];
  }else{
    RoomManager.publishMessage(room, {type: 'room.update', data: {
      type: 'leave',
      userId: userId,
      room,
    }}); 
  }
  
};

RoomManager.onUserMessage = (session, msg) => {
  let userId = session.userId;
  let roomId = session.roomId;

  let room = ROOM_HASH[roomId];
  if(!room) return;
  
  msg.data.from = userId;
  
  if(msg.type == 'file.new'){ //publish to all users
    RoomManager.publishMessage(room, msg);
  }else if(msg.type == 'downloadLink.request'){
    let serverUserId = msg.data.serverUserId;
    if(!RoomManager.isUserInRoom(room, serverUserId)) throw Error('serverUserId not belong to room');
    
    msg.data.clientUserId = userId;
    SessionManager.sendPushMessage(serverUserId, msg);
  }else if(msg.type == 'downloadLink.response'){
    let clientUserId = msg.data.clientUserId;
    if(!RoomManager.isUserInRoom(room, clientUserId)) throw Error('serverUserId not belong to room');
    
    msg.data.serverUserId = userId;
    SessionManager.sendPushMessage(clientUserId, msg);
  }else if(msg.type == 'downloadLink.serverStatus'
    || msg.type == 'downloadLink.serverRtcAnswer'
  ){
    let clientUserId = msg.data.clientUserId;
    if(!RoomManager.isUserInRoom(room, clientUserId)) throw Error('serverUserId not belong to room');
    
    msg.data.serverUserId = userId;
    SessionManager.sendPushMessage(clientUserId, msg);
  }else if(msg.type == 'downloadLink.clientStatus'
    || msg.type == 'downloadLink.clientRtcOffer'
  ){
    let serverUserId = msg.data.serverUserId;
    if(!RoomManager.isUserInRoom(room, serverUserId)) throw Error('serverUserId not belong to room');
    
    msg.data.clientUserId = userId;
    SessionManager.sendPushMessage(serverUserId, msg);
  }else if(msg.type == 'room.applyResponse'){
    let applyUserId = msg.data.applyUserId;
    
    if(!(room.ownerId == userId)) throw Error('not owner');

    if(msg.data.isApproved){
      RoomManager.join(applyUserId, roomId).then( () => {
        SessionManager.sendPushMessage(applyUserId, {
          type: 'room.applyResponse',
          data: Object.assign(msg.data, {room}),
        });
      });
    }else{
      SessionManager.sendPushMessage(applyUserId, {
        type: 'room.applyResponse',
        data: msg.data,
      });
    }
  }else{
    console.error('msg.type not supported', msg.type);
  }
};

RoomManager.publishMessage = function(room, msg){
  SessionManager.sendPushMessage(room.ownerId, msg);
  for(let userId of room.guestIdList){
    SessionManager.sendPushMessage(userId, msg);
  }
};

RoomManager.isUserInRoom = function(room, userId){
  return room.ownerId == userId || room.guestIdList.includes(userId);
};
