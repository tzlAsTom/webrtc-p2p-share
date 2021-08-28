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

RoomManager.join = async (userId, roomId) => {
  let session = SessionManager.get(userId);
  if(session.roomId){
    RoomManager.leave(session);
  }
  
  let room = ROOM_HASH[roomId];
  if(!room) throw Error('room not found:' + roomId);
  
  room.guestIdList.push(userId);
  session.roomId = roomId;
  //todo: publish message
  
  return room;  
};

RoomManager.leave = (session) => {
  let userId = session.userId;
  let roomId = session.roomId;
  if(!roomId) return;
  
  session.roomId = undefined;
  
  let room = ROOM_HASH[roomId];
  if(room){
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
    }
  }
};

RoomManager.onUserMessage = (session, msg) => {
  let userId = session.userId;
  let roomId = session.roomId;

  let room = ROOM_HASH[roomId];
  if(!room) return;
  
  msg.data.from = userId;
  
  if(msg.type == 'file.new'){ //publish to all users
    let tmp = [room.ownerId].concat(room.guestIdList);
    for(let userId of tmp){
      let userSession = SessionManager.get(userId);
      userSession.ws && userSession.ws.send(JSON.stringify(msg));
    }
  }else if(msg.type == 'downloadLink.request'){
    let serverUserId = msg.data.serverUserId;
    if(!RoomManager.isUserInRoom(room, serverUserId)) throw Error('serverUserId not belong to room');
    
    let serverUserSession = SessionManager.get(serverUserId);
    msg.data.clientUserId = userId;
    serverUserSession.ws && serverUserSession.ws.send(JSON.stringify(msg));
  }else if(msg.type == 'downloadLink.response'){
    let clientUserId = msg.data.clientUserId;
    if(!RoomManager.isUserInRoom(room, clientUserId)) throw Error('serverUserId not belong to room');
    
    let clientUserSession = SessionManager.get(clientUserId);
    msg.data.serverUserId = userId;
    clientUserSession.ws && clientUserSession.ws.send(JSON.stringify(msg));
  }else if(msg.type == 'downloadLink.serverStatus'
    || msg.type == 'downloadLink.serverRtcAnswer'
  ){
    let clientUserId = msg.data.clientUserId;
    if(!RoomManager.isUserInRoom(room, clientUserId)) throw Error('serverUserId not belong to room');
    
    let clientUserSession = SessionManager.get(clientUserId);
    msg.data.serverUserId = userId;
    clientUserSession.ws && clientUserSession.ws.send(JSON.stringify(msg));
  }else if(msg.type == 'downloadLink.clientStatus'
    || msg.type == 'downloadLink.clientRtcOffer'
  ){
    let serverUserId = msg.data.serverUserId;
    if(!RoomManager.isUserInRoom(room, serverUserId)) throw Error('serverUserId not belong to room');
    
    let serverUserSession = SessionManager.get(serverUserId);
    msg.data.clientUserId = userId;
    serverUserSession.ws && serverUserSession.ws.send(JSON.stringify(msg));
  }else{
    console.error('msg.type not supported', msg.type);
  }
};

RoomManager.isUserInRoom = function(room, userId){
  return room.ownerId == userId || room.guestIdList.includes(userId);
};
