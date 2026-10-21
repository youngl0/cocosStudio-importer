'use strict';
const path=require('path');
const {Worker}=require('worker_threads');
const {scan}=require('./lib/source');
const {importTarget}=require('./lib/output-store');
const updater=require('./lib/updater'),manifest=require('./package.json');
let current={phase:'idle'},running=false,updateBusy=false,release=null;
let updateState={phase:'idle',current:manifest.version,repo:updater.repository(manifest.repository.url)};
exports.methods={
 open(){Editor.Panel.open('cocos-studio-importer');},
 defaults(){return {project:Editor.Project.path,mode:'direct',folder:'studio'};},
 scan(ccs){return scan(ccs);},status(){return current;},
 'update-status'(){return {...updateState,importing:running};},
 async 'check-update'(){
  if(updateBusy)throw new Error('已有更新任务正在执行');
  if(updateState.phase==='restart-required')return updateState;
  updateBusy=true;release=null;updateState={...updateState,phase:'checking',available:false,message:'正在检查 GitHub Release',error:null};
  try{release=await updater.check({repo:updateState.repo,current:manifest.version});updateState={...updateState,source:release.source,available:release.available,phase:release.available?'available':'up-to-date',latest:release.latest,notes:release.notes,releaseUrl:release.releaseUrl,message:release.available?'发现新版本 '+release.latest:'当前已是最新稳定版'};}
  catch(e){updateState={...updateState,phase:'failed',error:e.message,message:'检查更新失败'};}finally{updateBusy=false;}
  return updateState;
 },
 async 'install-update'(){
  if(running||updateBusy)throw new Error('请等待当前导入或更新任务完成');
  if(!release?.available||updateState.phase==='restart-required')throw new Error('请先检查是否有新版本');
  updateBusy=true;
  try{
   const home=Editor.App.home||path.join(require('os').homedir(),'.CocosCreator');
   const result=await updater.install({release,root:__dirname,allowedRoots:[path.join(Editor.Project.path,'extensions',manifest.name),path.join(home,'extensions',manifest.name)],current:manifest.version,editorVersion:Editor.App.version,onProgress:(phase,message)=>{updateState={...updateState,phase,message,error:null};}});
   updateState={...updateState,...result};
  }catch(e){updateState={...updateState,phase:'failed',error:e.message,message:'安装更新失败；原版本仍可使用，详情见错误信息'};}finally{updateBusy=false;}
  return updateState;
 },
 start(options){
  if(updateBusy||updateState.phase==='restart-required')throw new Error('更新处理中或等待重新加载扩展，请完成后再导入');
  if(running)throw new Error('已有转换任务正在执行');
  if(!options.selection?.length)throw new Error('请至少选择一个 CSD');
  const {folder,output}=importTarget(Editor.Project.path,options.folder);
  running=true;current={phase:'planning',message:'直接转换 Cocos Studio 资源…',output};
  const worker=new Worker(path.join(__dirname,'lib/direct-worker.js'),{workerData:{ccs:options.ccs,selection:options.selection,output}});
  let settled=false;
  worker.on('message',async message=>{
   if(message.kind==='progress'){current={...current,...message.value};return;}
   if(message.kind==='error'){settled=true;running=false;current={phase:'failed',...message.value};return;}
   if(message.kind==='result'){
    settled=true;const report=message.value;
    current={phase:'importing',message:'转换完成，Creator 正在导入资源',reportPath:report.reportPath};
    try{await Editor.Message.request('asset-db','refresh-asset','db://assets/'+folder);current={phase:report.phase,output,reportPath:report.reportPath,message:'已处理 '+report.prefabs.length+' 个 Prefab；新增 '+report.createdResources+' 项资源，复用 '+report.reusedResources+' 项；'+report.warnings.length+' 项提示，详见报告'};}
    catch(e){current={...current,phase:'failed',error:e.stack};}finally{running=false;}
   }
  });
  worker.on('error',e=>{settled=true;running=false;current={phase:'failed',error:e.stack};});
  worker.on('exit',code=>{if(!settled){running=false;current={phase:'failed',error:'转换线程异常退出：'+code};}});
  return current;
 }
};
exports.load=()=>{};exports.unload=()=>{};
