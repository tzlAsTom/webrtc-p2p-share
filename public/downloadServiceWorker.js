'use strict';

const encoder = new TextEncoder();

self.addEventListener('install', function(event) {
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

let JOB_HASH = {};
self.addEventListener('fetch', (event) => {
  let urlObj = new URL(event.request.url);
  console.log('fetch', urlObj);
  if(!urlObj.pathname.startsWith('/downloadServiceWorker/'))  return fetch(event.request);

  var searchParams  = new URLSearchParams(urlObj.search);
  var queryObj = Object.fromEntries( searchParams.entries());
  console.log(queryObj);
  let {jobId, fileName, fileSize, fileType} = queryObj;
  fileSize = parseInt(fileSize);
  if(!(jobId && fileName)){
    console.error('jobId or fileName missgin');
    return;
  }
  
  let job = {
    params: queryObj,
  };
   
  let counter = 1;
  let relaySteam = new ReadableStream({
    start(controller) {
      job.controller = controller;
    }
  });
  JOB_HASH[jobId] = job;
  
  let response = new Response(relaySteam, {
    status: 200,
    headers: {
      'Content-Type':  (fileType || 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${fileName}"`, 
      'Content-Length': (fileSize || 0),
    },
  });
  console.log(response);
  event.respondWith(response);
});

self.onmessage = function(e) {
  console.log('Message received in worker', e.data);
  let data = e.data;
  if(data && data.type == 'download.newData'){
    let jobId = parseInt(data.jobId);
    let job = JOB_HASH[jobId];
    if(!job){
      console.log('job not found', jobId);
      return;
    }
    
    return job.controller.enqueue(data.buf);
  }else if(data && data.type == 'download.finish'){
    let jobId = parseInt(data.jobId);
    let job = JOB_HASH[jobId];
    if(!job){
      console.log('job not found', jobId);
      return;
    }
    job.controller.close();
    delete JOB_HASH[jobId];
    return;
  }else{
    console.log('Unsupport message data', data);
  }
}
