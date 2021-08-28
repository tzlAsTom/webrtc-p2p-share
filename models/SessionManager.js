'use strict';

let SessionManager = module.exports;
let IdGenerator = require('./IdGenerator');

/*
 * userId:
 *  session
 */
let SESSION_HASH = {};
SessionManager.init = async (session) => {
  session.userId = await IdGenerator.next('userId');
  session.roomId = undefined; //current roomId
  //session.ws //webSocket
  
  SESSION_HASH[session.userId] = session;
};

SessionManager.get = (userId) => {
  return SESSION_HASH[userId];
};

//todo keepAlive
