'use strict';
const {parentPort,workerData}=require('worker_threads');
try{const result=require('./direct').convert(workerData,value=>parentPort.postMessage({kind:'progress',value}));parentPort.postMessage({kind:'result',value:result});}
catch(e){parentPort.postMessage({kind:'error',value:{error:e.stack,reportPath:e.reportPath,missing:e.report?.missing}});}
