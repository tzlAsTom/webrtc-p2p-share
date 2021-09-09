var createError = require('http-errors');
var express = require('express');
var path = require('path');
const cookie = require('cookie');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

const ws = require("ws");
const memorystore = require('memorystore')(session);

const SessionManager = require('./models/SessionManager');
const RoomManager = require('./models/RoomManager');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');


app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const COOKIE_NAME = 'connect.sid';
const COOKIE_SECRET = 'aaaaaaaaaaaaaa';
const SESSION_STORE = new memorystore({
  checkPeriod: 8 * 3600 * 1000,
});
let sessionInstance = session({
    secret: COOKIE_SECRET,
    name: COOKIE_NAME,
    resave: false,
    cookie: {maxAge: 60 * 60 * 24 * 1000 },
    saveUninitialized: false,
    store: SESSION_STORE,
});
app.use(sessionInstance);

app.use(function(req, res, next) {
  res.header("Cross-Origin-Embedder-Policy", "require-corp");
  res.header("Cross-Origin-Opener-Policy", "same-origin");
  res.header("Cross-Origin-Resource-Policy", "same-site");
  
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.use(function(req, res, next){
  (async () => {
    if(!req.session.userId){
      await SessionManager.init(req.session);
    }

    next();
  })().catch( (err) => {
    next(err);
  });
});

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  console.log(err);
  
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  if(req.accepts('json')){
    res.json({err: err})
  }else{
    res.render('error');
  }
});

app.setupWebsocket = function(server){
  const wss = new ws.Server({ noServer: true });
  
  wss.on('connection', function connection(ws, request) {
    let userId = request.userId;
    let session = SessionManager.get(userId);

    session.ws = ws;
    console.log('new webSocket', userId);
    
    ws.on('message', function message(msg) {
      console.log('Received message', userId, msg.toString());
      try{
        let msgObj = JSON.parse(msg.toString());
        RoomManager.onUserMessage(session, msgObj);
      }catch(err){
        console.error(err);
      }
    });
  });

  server.on('upgrade', function upgrade(request, socket, head) {
    function onError(){
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
    }
    
    let cookieStr = request.headers['cookie'];
    if(!cookieStr) return onError();

    let cookieObj = cookie.parse(cookieStr);
    //console.log(cookieObj);

    let signedSessionId = cookieObj[COOKIE_NAME];
    if(!signedSessionId) return onError();

    let sessionId = cookieParser.signedCookie(signedSessionId, COOKIE_SECRET)
    if(!sessionId) return onError();
    //console.log(sessionId);
    SESSION_STORE.get(sessionId, (err, result) => {
      if(err){
        console.error(err);
        return onError();
      }
      
      if(!(result && result.userId)){
        console.log('session invalid', sessionId);
        return onError();
      }
      
      request.userId = result.userId;
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request);
      });
    });

  });
};

module.exports = app;
