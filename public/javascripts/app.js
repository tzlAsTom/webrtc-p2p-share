'use strict';

var serviceWorker;
var webSocket;
var room, myUserId;

let dataContainer = {
  __shareFileSeq: 0,
  chatList: [],
  shareFileHash: {
    //[Seq]: [FILE]
  },
  downloadLinkSetupAwaiterHash: {
    //[jobId]: {resolve}
  },
  clientOpenConnectionHash: {
    //[jobId]: {}
  },
  serverOpenConnectionHash: {
    //[clientUserId_jobId]: {}
  },
  rtcConfig: {
    iceServers: [
      {urls: [/*"stun:stun.l.google.com:19302",*/"stun:10.0.2.15:3478",/*"stun:my.com:3478"*/]},
    ],
  },
};

function init(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/downloadServiceWorker.js', {scope: '/downloadServiceWorker/'})
    .then((reg) => {
      // registration worked
      serviceWorker = reg.active;
      console.log('Registration succeeded. Scope is ' + reg.scope);
    }).catch((err) => {
      // registration failed
      onInitError('Registration failed with ' + err);
    });
  }else{
      onInitError('serviceWorker not supported');
  }
  
  
  let curUrlObj = new URL(window.location.href);
  webSocket = new WebSocket((curUrlObj.protocol == 'https:'?'wss':'ws') + '://' + curUrlObj.hostname + ':' + curUrlObj.port + '/webSocket');
  webSocket.onError = onInitError;
  webSocket.addEventListener('message', function (event) {
    console.log('Message from server ', event.data);
    try{
      let msg = JSON.parse(event.data.toString());
      if(msg.type == 'file.new'){
        //{"type":"file.new","data":{"name":"google-chrome-stable_current_amd64 (1).deb","type":"application/vnd.debian.binary-package","size":80228636,"from":107}}
        dataContainer.chatList.push(msg);
        
        let el = document.createElement("span");
        let txtNode = document.createTextNode('[user #' + msg.data.from  + ']' + msg.data.name + ' ' + formatSize(msg.data.size) + ' ');
        el.appendChild(txtNode);
        
        let div = document.createElement('div');
        div.appendChild(el);
        
        let jobId = downloadProxy.nextJobId();
        let url = downloadProxy.downloadUrl({
          jobId,
          fileName: msg.data.name,
          fileSize: msg.data.size,
          fileType: msg.data.type,
        });
        let downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.innerText = 'Download';
        div.appendChild(downloadLink);
        
        downloadLink.addEventListener('click', () => {
          (async () => {
            let receiveChannel = await setupDownloadLink({
              serverUserId: msg.data.from,
              fileId: msg.data.id,
              jobId: jobId,
            });
            
            receiveChannel.onmessage = function(event){
              downloadProxy.newData(jobId, new Uint8Array( event.data) );
            };
            receiveChannel.onclose = function(event) {
              //todo: check error
              downloadProxy.finish(jobId);
              //todo: clean connection
            };
            receiveChannel.onopen = (event) => {
              //console.log('reciveChannel onopen', receiveChannel);
            };
          })().catch(onPageError);
        });

        document.getElementById('chatHistoryPage').appendChild(div);
      }else if(msg.type == 'downloadLink.response'
        || msg.type == 'downloadLink.serverRtcAnswer'
      ){
        let jobId = msg.data.jobId;
        let awaiter = dataContainer.downloadLinkSetupAwaiterHash[jobId];
        if(!awaiter) throw Error('awaiter not found:' + jobId);
        if(!(awaiter.awaitName == msg.type)) throw Error('awaitName not match:' + jobId);
                      
        if(msg.err) awaiter.reject(msg.err);
        awaiter.resolve(msg.data);
      }else if(msg.type == 'downloadLink.request'){
        let file = dataContainer.shareFileHash[msg.data.fileId];
        if(!file) throw Error('file not found' + msg.data.fileId);
        
        webSocket.send(JSON.stringify({type: 'downloadLink.response', data: msg.data}));
        let connection = new RTCPeerConnection(dataContainer.rtcConfig);
        connection.ondatachannel =  function (event) {
          let sendChannel = event.channel;
          sendChannel.bufferedAmountLowThreshold = 65535;
          
          let reader = file.stream().getReader();
          let fileReaderHandler = function({done, value}){
            if(done){
              console.log('Stream complete');
              sendChannel.close();
              return;
            }

            console.log(done, value.length);
            for(let start = 0; start < value.length;){
              let end = start + 16 * 1000;
              let sliceContent = value.subarray(start, end);
              sendChannel.send(sliceContent);
              start = end;
            }
          };
          
          function fillBuffer(){
              let totalSize = 0;
              reader.read().then(function handlerWrapper({done, value}){
                fileReaderHandler({done, value});
                if(!done){
                    totalSize += value.length;
                    if(!(totalSize > sendChannel.bufferedAmountLowThreshold)){
                        reader.read().then(handlerWrapper);
                    }
                }
              });
          }
          
          //todo: bug on firefox
          sendChannel.addEventListener("bufferedamountlow", ev => {
            fillBuffer();
          });
          
          sendChannel.onopen = function(event){
            //console.log('sendChannel opened', sendChannel);
            //sendChannel.send('xxx');
            fillBuffer();
          };
          sendChannel.onclose = function(event){
            //todo close connection
          };
        };
        
        connection.onicecandidate = (e) => {
          if(e.candidate){
            webSocket.send(JSON.stringify({type: 'downloadLink.serverStatus', data: Object.assign({candidate: e.candidate}, msg.data)}));
          }
        };
        
        dataContainer.serverOpenConnectionHash[msg.data.clientUserId + '_' + msg.data.jobId] = {connection};
      }else if(msg.type == 'downloadLink.clientRtcOffer'){
        let key = msg.data.clientUserId + '_' + msg.data.jobId;
        let connection = dataContainer.serverOpenConnectionHash[key] && dataContainer.serverOpenConnectionHash[key].connection;
        if(!connection) throw Error('connection not found:' + key);
                             
        connection.setRemoteDescription(msg.data.clientDescription).then( () => {
          return connection.createAnswer();
        }).then( (answer) => {
          return connection.setLocalDescription(answer);
        }).then( () => {
          webSocket.send(JSON.stringify({
            type: 'downloadLink.serverRtcAnswer',
            data: Object.assign( {
              serverDescription: connection.localDescription,
            }, msg.data, {clientDescription: undefined}),
          }));
        }).catch(onPageError);
      }else if(msg.type == 'downloadLink.clientStatus'){
        let key = msg.data.clientUserId + '_' + msg.data.jobId;
        let connection = dataContainer.serverOpenConnectionHash[key] && dataContainer.serverOpenConnectionHash[key].connection;
        if(!connection) throw Error('connection not found:' + key);
                      
        connection.addIceCandidate(msg.data.candidate);
      }else if(msg.type == 'downloadLink.serverStatus'){
        let key = msg.data.jobId;
        let connection = dataContainer.clientOpenConnectionHash[key] && dataContainer.clientOpenConnectionHash[key].connection;
        if(!connection) throw Error('connection not found:' + key);
                      
        connection.addIceCandidate(msg.data.candidate);
      }
    }catch(err){
      onPageError(err);
    }
  });
  
  document.getElementById('createRoomConfirmButton').addEventListener('click', () => {
    showLoading();
    fetch('/room/create', {method: 'POST'})
    .then(response => response.json())
    .then((result) => {
      if(result.err) throw Error(result.err);
      room = result.room;
      myUserId = result.userId;
      
      document.getElementById('roomWelcomeHeader').innerText = '; Room #' + room.roomId;
      showRoomPage();
    }).catch( (err) => {
      onPageError(err);
    }).then( () => {
      dismissLoading();
      let modal = bootstrap.Modal.getInstance(document.getElementById('createRoomModal'));
      modal.toggle();
    });
  });
  
  document.getElementById('joinRoomConfirmButton').addEventListener('click', () => {
    showLoading();
    fetch('/room/join', {
      method: 'POST', 
      body: JSON.stringify({roomId: document.getElementById('joinRoomModalRoomId').value}),  
      headers: new Headers({'accept': 'application/json', 'content-type': 'application/json'}),
    }).then(response => response.json())
    .then((result) => {
      if(result.err) throw Error(result.err);
      room = result.room;
      myUserId = result.userId;
      
      document.getElementById('roomWelcomeHeader').innerText = '; Room #' + room.roomId;
      showRoomPage();
    }).catch( (err) => {
      onPageError(err);
    }).then( () => {
      dismissLoading();
      let modal = bootstrap.Modal.getInstance(document.getElementById('joinRoomModal'));
      modal.toggle();
    });
  });
  
  document.getElementById('shareFileBtn').addEventListener('click', () => {
    //todo: disable shareFileBtn when no file selected他
    let file = document.getElementById('fileInput').files[0];
    if(!file) return;
 
    //todo: error when not guest

    let id = ++dataContainer.__shareFileSeq;
    dataContainer.shareFileHash[id] = file;
    console.log(file.name, file.type, file.size);
    webSocket.send(JSON.stringify({type: 'file.new', data: {id: id, name: file.name, type: file.type, size: file.size}}));
  });
  
  document.getElementById('test').addEventListener('click', () => {
    let sharedBuffer = new SharedArrayBuffer(1024);
    //const sharedArray = new Uint8Array(sharedBuffer);
    //sharedArray[0] = 100;
    //setInterval( () => {
    //  console.log('main', sharedArray);
    //}, 1000);
    
    serviceWorker.postMessage(sharedBuffer); //failed. FML
    serviceWorker.postMessage('xxxx');
  });
  
  downloadProxy.test();
}

function showLoading(){
  document.getElementById('loadingPage').style.display = 'block';
}

function dismissLoading(){
  document.getElementById('loadingPage').style.display = 'none';
}

function showRoomPage(){
  document.getElementById('mainIndexPage').style.display = 'none';
  document.getElementById('roomIndexPage').style.display = 'block';
}

function dismissRoomPage(){
  document.getElementById('mainIndexPage').style.display = 'block';
  document.getElementById('roomIndexPage').style.display = 'none';
}

function formatSize(size){
  let unitList = ['byte', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unitIndex = 0;
  while(size > 1024 && unitIndex < (unitList.length - 1)){
      size = size / 1024;
      unitIndex++;
  }
  
  return Math.floor(size * 100) / 100 + unitList[unitIndex];
}

async function setupDownloadLink(params){
  await webSocket.send(JSON.stringify({type: 'downloadLink.request', data: params}));
  let result = await new Promise( (resolve, reject) => {
    dataContainer.downloadLinkSetupAwaiterHash[params.jobId] = {resolve, reject, awaitName: 'downloadLink.response'};
  });
  
  let connection = new RTCPeerConnection(dataContainer.rtcConfig);

  let receiveChannel = connection.createDataChannel("fileShare");
  
  let offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await webSocket.send(JSON.stringify({
    type: 'downloadLink.clientRtcOffer', 
    data: Object.assign({
      clientDescription: connection.localDescription,
    }, params),
  }));
  
  result = await new Promise( (resolve, reject) => {
    dataContainer.downloadLinkSetupAwaiterHash[params.jobId] = {resolve, reject, awaitName: 'downloadLink.serverRtcAnswer'};
  });
  
  await connection.setRemoteDescription(result.serverDescription);
  
  connection.onicecandidate = (e) => {
    if(e.candidate){
      webSocket.send(JSON.stringify({type: 'downloadLink.clientStatus', data: Object.assign({candidate: e.candidate}, params) }));
    }
  };
  
  dataContainer.clientOpenConnectionHash[params.jobId] = {connection};
  
  return receiveChannel;
}

function onInitError(err){
  //todo add error page
  console.log('initError', err);
}

function onPageError(err){
  //todo
  console.log('pageError', err);
}


/*stream download:
 *  usage:
 *    *download a file without server
 *    *file source is stream  
 *  process:
 *    *[html page]start dowloading a file && downloadServiceWorker intercept request
 *    *[html page]get more data from p2p network. send to downloadServiceWorker.
 *    *[downloadServiceWorker]implements a stream source for that file
 *    *[html page]get EOF signal. send to downloadServiceWorker.
 *    *[downloadServiceWorker]when finishe get called. Close stream.
 */
function downloadProxy(){
}

downloadProxy.__jobId = 1;

downloadProxy.nextJobId = () => {
  return downloadProxy.__jobId++;
};

/*
 * params:
 *    jobId:
 *    fileName:
 *    fileSize: 
 *    fileType：
 */
downloadProxy.downloadUrl =  (params = {}, opts = {}) => {
  let jobId = downloadProxy.__jobId++;
  
  var searchParams  = new URLSearchParams(params);
  return '/downloadServiceWorker/download/start?' + searchParams.toString();
};

downloadProxy.newData = (jobId, buf) => {
  return serviceWorker.postMessage({
      type: 'download.newData',
      jobId,
      buf,   //todo: use SharedArrayBuffer
  });
};

downloadProxy.finish = (jobId) => {
  return serviceWorker.postMessage({
      type: 'download.finish',
      jobId
  });
};

downloadProxy.test = () => {
  let encoder = new TextEncoder();
    
  let lineStrList = [
    'aaaaaaaaaaaaaaa\n',
    'bbbbbbbbbbbbbbb\n',
    'ccccccccccccccc\n',
    'ddddddddd为俄dddddd\n',
  ];
  let fileSize = 0;
  lineStrList.forEach( (lineStr) => {
    fileSize += encoder.encode(lineStr).length;
  });
  let jobId = downloadProxy.nextJobId();
  let url = downloadProxy.downloadUrl({
    jobId,
    fileName: 'downloadTest.txt',
    fileSize: fileSize,
    fileType: 'application/octet-stream',
  });
  
  document.body.appendChild(document.createElement('br'));
  let testLink = document.createElement("a");
  testLink.href = url;
  testLink.innerText = 'Download Test';
  document.body.appendChild(testLink);

  testLink.addEventListener('click', () => {
      (async () => {
        for(let lineStr of lineStrList){
          await new Promise( (resolve) => {
              setTimeout( () => {
                  resolve();
              }, 1000);
          });
                    
          downloadProxy.newData(jobId, encoder.encode(lineStr));
        }
        
        downloadProxy.finish(jobId);
      })().catch(console.log);
  });
};

window.addEventListener('load', init, false);




