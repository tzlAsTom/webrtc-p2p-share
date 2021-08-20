'use strict';

var serviceWorker;
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
  
  document.getElementById('test').addEventListener('click', () => {
    let sharedBuffer = new SharedArrayBuffer(4);
    const sharedArray = new Uint8Array(sharedBuffer);
    sharedArray[0] = 100;
    //setInterval( () => {
    //  console.log('main', sharedArray);
    //}, 1000);
    
    //serviceWorker.postMessage(sharedBuffer); //failed. FML
    serviceWorker.postMessage('xxxx');
  });
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

init();
downloadProxy.test();



