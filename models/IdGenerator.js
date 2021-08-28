'use strict';

const fs = require('fs/promises');

let IdGenerator = module.exports;

let CACHE = {};
IdGenerator.next = async (name) => {
  await loadCache(name);
  let ret = ++CACHE[name];
  await syncCache(name);
  
  return ret;
};

async function loadCache(name){
  if(CACHE[name]) return;
  
  try{
    let fileContent = await fs.readFile(__dirname + `/../cache/${name}`);
    let tmp = parseInt(fileContent);
    if(isNaN(tmp)) throw new Error('invalid content', fileContent);
    CACHE[name] = tmp;
  }catch(err){
    if (err.code === 'ENOENT') {
      console.log('init');
      CACHE[name] = 0;
    }else{
      throw err;
    }
  }
  
  return;
}

async function syncCache(name){
  console.log('syncCache', name, CACHE[name]);
  await fs.writeFile(__dirname + `/../cache/${name}`, CACHE[name].toString());
}
