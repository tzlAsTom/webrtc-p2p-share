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
  roomApplyRequestAwaiter: undefined,
};

function init(){
  (async () => {
    if(!('serviceWorker' in navigator)) throw Error('Service Worker not supported.Try to update your browser.');
    
    await navigator.serviceWorker.register('/downloadServiceWorker.js', {scope: '/downloadServiceWorker/'})
    .then((reg) => {
      serviceWorker = reg.active;
      console.log('Registration succeeded. Scope is ' + reg.scope);
    }).catch((err) => {
      throw Error('Service Worker registration failed: ' + err.toString());
    });
    
    await fetch('/status', {
      headers: new Headers({'accept': 'application/json'}),
    }).then(response => response.json())
    .then((result) => {
      if(result.err) throw Error(result.err);
      
      myUserId = result.userId;
      document.getElementById('userWelcomeHeader').innerText = formatUserId(myUserId);
      if(result.room){
        room = result.room;
        showRoomPage();
      }
    });
    
    await setupWebSocket();
 
    document.getElementById('createRoomConfirmButton').addEventListener('click', () => {
      showLoading();
      fetch('/room/create', {
        method: 'POST',
        headers: new Headers({'accept': 'application/json', 'content-type': 'application/json'}),
      }).then(response => response.json())
      .then((result) => {
        if(result.err) throw Error(result.err);
        room = result.room;
    
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

      fetch('/room/apply', {
        method: 'POST', 
        body: JSON.stringify({roomId: document.getElementById('joinRoomModalRoomId').value}),  
        headers: new Headers({'accept': 'application/json', 'content-type': 'application/json'}),
      }).then(response => response.json())
      .then( (result) => {
        if(result.err) throw Error(result.err);
        
        return new Promise((resolve, reject) => {
          dataContainer.roomApplyRequestAwaiter = {resolve, reject};
        });
      }).then((data) => {
        if(!data.isApproved) throw Error('Reject by owner!');

        room = data.room;
        
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
      //todo: disable shareFileBtn when no file selected
      let file = document.getElementById('fileInput').files[0];
      if(!file) return;
  
      //todo: error when not guest

      let id = ++dataContainer.__shareFileSeq;
      dataContainer.shareFileHash[id] = file;
      console.log(file.name, file.type, file.size);
      webSocket.send(JSON.stringify({type: 'file.new', data: {id: id, name: file.name, type: file.type, size: file.size}}));
    });
    
    document.getElementById('errorAlertDismissBtn').addEventListener('click', () => {
      dismissAlert();
    });
    
    document.getElementById('roomLeaveBtn').addEventListener('click', () => {
      let modal = new bootstrap.Modal(document.getElementById('leaveRoomModal'));
      modal.toggle();
    });
    
    document.getElementById('leaveRoomConfirmBtn').addEventListener('click', () => {
      showLoading();
      
      fetch('/room/leave', {
        method: 'POST', 
        body: '',  
        headers: new Headers({'accept': 'application/json', 'content-type': 'application/json'}),
      }).then(response => response.json())
      .then( (result) => {
        if(result.err) throw Error(result.err);
            
        room = undefined;
        dismissRoomPage();
      }).catch( (err) => {
        onPageError(err);
      }).then( () => {
        dismissLoading();
        let modal = bootstrap.Modal.getInstance(document.getElementById('leaveRoomModal'));
        modal.toggle();
      });
    });
    
//     document.getElementById('test').addEventListener('click', () => {
//       showAlert(Error('sssssssssssss'));
//       
//       //let sharedBuffer = new SharedArrayBuffer(1024);
//       //const sharedArray = new Uint8Array(sharedBuffer);
//       //sharedArray[0] = 100;
//       //setInterval( () => {
//       //  console.log('main', sharedArray);
//       //}, 1000);
//       
//       //serviceWorker.postMessage(sharedBuffer); //failed. FML
//       //serviceWorker.postMessage('xxxx');
//     });
    
    //downloadProxy.test();
  })().then( () => {
    dismissLoading();
    console.log('init success');
  }).catch( (err) => {
    onInitError(err);
  });
}

function showLoading(){
  document.getElementById('loadingPage').style.visibility = 'visible';
}

function dismissLoading(){
  document.getElementById('loadingPage').style.visibility = 'hidden';
}

function showAlert(msg){
  document.getElementById('errorAlertMsg').innerText = msg.toString();
  document.getElementById('errorAlert').style.visibility = 'visible';
}

function dismissAlert(){
  document.getElementById('errorAlert').style.visibility = 'hidden';
}

function showRoomPage(){
  document.getElementById('roomWelcomeHeader').innerText = '; ' + formatRoomId(room.roomId);
  document.getElementById('roomLeaveBtn').style.display = 'inline-block';
  
  document.getElementById('mainIndexPage').style.display = 'none';
  document.getElementById('roomIndexPage').style.display = 'block';
}

function dismissRoomPage(){
  document.getElementById('roomWelcomeHeader').innerText = '';
  document.getElementById('roomLeaveBtn').style.display = 'none';
  
  document.getElementById('mainIndexPage').style.display = 'block';
  document.getElementById('roomIndexPage').style.display = 'none';
}

function setupWebSocket(){
  return new Promise((resolve, reject) => {
    let curUrlObj = new URL(window.location.href);
    webSocket = new WebSocket((curUrlObj.protocol == 'https:'?'wss':'ws') + '://' + curUrlObj.hostname + ':' + curUrlObj.port + '/webSocket');
    webSocket.onerror = reject;
    webSocket.onopen = resolve;
    webSocket.addEventListener('message', function (event) {
      console.log('Message from server ', event.data);
      try{
        let msg = JSON.parse(event.data.toString());
        if(msg.type == 'room.update'){
          dataContainer.chatList.push(msg);
          if(msg.data.room) room = msg.data.room;
          
          let el = document.createElement("span");
          let txtNode = document.createTextNode(formatChatTime(Date.now()) + ' [System]' + formatUserId(msg.data.userId) + ' ' + msg.data.type + ' room');
          el.appendChild(txtNode);
          
          let div = document.createElement('div');
          div.appendChild(el);
          
          document.getElementById('chatHistoryPage').appendChild(div);
        }else if(msg.type == 'file.new'){
          //{"type":"file.new","data":{"name":"google-chrome-stable_current_amd64 (1).deb","type":"application/vnd.debian.binary-package","size":80228636,"from":107}}
          dataContainer.chatList.push(msg);
          
          let el = document.createElement("span");
          let txtNode = document.createTextNode(formatChatTime(Date.now()) + ' [' + formatUserId(msg.data.from)  + ']' + msg.data.name + ' ' + formatSize(msg.data.size) + ' ');
          el.appendChild(txtNode);
          
          let div = document.createElement('div');
          div.appendChild(el);
          
          let downloadBtn = document.createElement('button');
          downloadBtn.innerText = 'Download';
          div.appendChild(downloadBtn);
          
          downloadBtn.addEventListener('click', () => {
            downloadChatFile(msg);
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

              //console.log(done, value.length);
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
        }else if(msg.type == 'room.applyRequest'){
          showRoomApplyConfirmToast(msg.data);
        }else if(msg.type == 'room.applyResponse'){
          let awaiter = dataContainer.roomApplyRequestAwaiter;
          if(!awaiter) throw Error('awaiter not found:' + jobId);
                        
          if(msg.err) awaiter.reject(msg.err);
          awaiter.resolve(msg.data);
          
          dataContainer.roomApplyRequestAwaiter = undefined;
        }
      }catch(err){
        onPageError(err);
      }
    });
  });
}

function showRoomApplyConfirmToast(data){
    //let data = {applyUserId: 11, timeStampMs: 1630397906283};
    let toastDom = document.getElementById('toastTemplate').cloneNode(true);
    toastDom.querySelector('#toastTitle').innerText = 'User #' + data.applyUserId;
    toastDom.querySelector('#toastTime').innerText = formatChatTime(data.timeStampMs);
    toastDom.querySelector('#toastBody').innerText = 'Request to join room.';
    let confirmHandler = (isApproved) => {
      webSocket.send(JSON.stringify({
        type: 'room.applyResponse',
        data: Object.assign(data, {isApproved}),
      }));
      
      toastObj.hide();
    };
    toastDom.querySelector('#toastAccept').addEventListener('click', () => {
      confirmHandler(true);
    });
    
    toastDom.querySelector('#toastReject').addEventListener('click', () => {
      confirmHandler(false);
    });
    
    let toastObj = bootstrap.Toast.getOrCreateInstance(toastDom);
    document.getElementById('toastContainer').appendChild(toastDom);
    toastObj.show();
    toastDom.addEventListener('hidden.bs.toast', function () {
      document.getElementById('toastContainer').removeChild(toastDom);
    });
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

function formatChatTime(timeStampMs){
  let date = new Date(timeStampMs);
  return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
}

function formatUserId(userId){
  return 'User #' + userId;
}

function formatRoomId(roomId){
  return 'Room #' + roomId;
}

function downloadChatFile(msg){
  (async () => {
    let jobId = downloadProxy.nextJobId();
    let url = downloadProxy.downloadUrl({
      jobId,
      fileName: msg.data.name,
      fileSize: msg.data.size,
      fileType: msg.data.type,
    });
    
    let link = document.createElement("a");
    link.href = url;
    link.style.display = 'none';
    link.innerText = 'Download';
    if(navigator.userAgent.indexOf('Firefox') != -1)  link.setAttribute('download', msg.data.name);
    document.body.appendChild(link);
    link.click();
    link.remove();

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
      console.log('reciveChannel onopen', jobId);
    };

    
  })().catch(onPageError);
}

async function setupDownloadLink(params){
  await webSocket.send(JSON.stringify({type: 'downloadLink.request', data: params}));
  let result = await new Promise( (resolve, reject) => {
    dataContainer.downloadLinkSetupAwaiterHash[params.jobId] = {resolve, reject, awaitName: 'downloadLink.response'};
  });
  
  let connection = new RTCPeerConnection(dataContainer.rtcConfig);
  dataContainer.clientOpenConnectionHash[params.jobId] = {connection};
  
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
  

  return receiveChannel;
}

function onInitError(err){
  showAlert(err);
}

function onPageError(err){
  showAlert(err);
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




