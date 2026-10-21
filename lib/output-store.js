'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function metaIds(meta){const ids=[];function visit(m){if(m?.uuid)ids.push(m.uuid);for(const sub of Object.values(m?.subMetas||{}))visit(sub);}visit(meta);return ids;}
function metaSignature(meta){
 if(!meta?.uuid||!meta.importer)return null;
 const aliases=new Map();function collect(m,key){if(typeof m.uuid!=='string'||!m.uuid||aliases.has(m.uuid))throw new Error('Invalid meta UUID');aliases.set(m.uuid,key);for(const [id,sub]of Object.entries(m.subMetas||{}))collect(sub,key+'/'+id);}collect(meta,'$root');
 function normalize(value){if(typeof value==='string'&&aliases.has(value))return aliases.get(value);if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)]));return value;}
 function project(m){const user={...m.userData};
  if(m.importer==='image')delete user.hasAlpha;
  if(m.importer==='texture'&&user.anisotropy===0)delete user.anisotropy;
  if(m.importer==='sprite-frame'){if(user.meshType===0)delete user.vertices;if(user.atlasUuid==='')delete user.atlasUuid;}
  if(m.importer==='prefab')delete user.syncNodeName;
  return {ver:m.ver,importer:m.importer,userData:normalize(user),subMetas:Object.fromEntries(Object.entries(m.subMetas||{}).map(([key,sub])=>[key,project(sub)]))};
 }
 return JSON.stringify(canonical(project(meta)));
}
function contentHash(data,ext){if(ext==='.prefab'){try{return digest(JSON.stringify(canonical(JSON.parse(data.toString('utf8')))));}catch(e){return digest(data);}}return digest(data);}
class OutputStore {
 constructor(root,report={}){
  this.root=path.resolve(root);this.report=report;this.paths=new Set();this.entries=[];this.events=new Map();this.uuidOwners=new Map();this.byContent=new Map();
  this.assertSafe(this.root);
  if(fs.existsSync(this.root)&&!fs.statSync(this.root).isDirectory())throw new Error('导入目标必须是目录');
  const visit=folder=>{for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const file=path.join(folder,item.name);this.paths.add(file.toLowerCase());if(item.isSymbolicLink())continue;if(item.isDirectory()){visit(file);continue;}if(!item.isFile()||item.name.endsWith('.meta')||/^studio-import-report(?:__.*)?\.json$/.test(item.name))continue;
   let meta=null;try{if(!fs.lstatSync(file+'.meta').isSymbolicLink())meta=JSON.parse(fs.readFileSync(file+'.meta','utf8'));}catch(e){}
   this.index(file,fs.readFileSync(file),meta,false);
  }};if(fs.existsSync(this.root))visit(this.root);
 }
 assertSafe(file){
  const resolved=path.resolve(file),relative=path.relative(this.root,resolved);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('输出资源路径越界');
  for(let current=resolved;;current=path.dirname(current)){try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('导入目录不能包含符号链接');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(current)===current)break;}
  return resolved;
 }
 index(file,data,meta,created){
  const ext=path.extname(file).toLowerCase(),entry={file,hash:contentHash(data,ext),ext,meta,created};try{entry.signature=metaSignature(meta);}catch(e){entry.signature=null;}
  this.entries.push(entry);const key=ext+':'+entry.hash;if(!this.byContent.has(key))this.byContent.set(key,[]);this.byContent.get(key).push(entry);
  for(const id of metaIds(meta)){if(!this.uuidOwners.has(id))this.uuidOwners.set(id,new Set());this.uuidOwners.get(id).add(file);}
  this.paths.add(file.toLowerCase());if(meta)this.paths.add((file+'.meta').toLowerCase());return entry;
 }
 freePath(relative,hash=digest(crypto.randomUUID())){
  const base=this.assertSafe(path.join(this.root,relative)),ext=path.extname(base),stem=ext?base.slice(0,-ext.length):base;let file=base,index=0;
  while(this.paths.has(file.toLowerCase())||this.paths.has((file+'.meta').toLowerCase())||fs.existsSync(file)||fs.existsSync(file+'.meta'))file=stem+'__'+hash.slice(0,8)+(index?'_'+index:'')+ext,index++;
  this.assertSafe(file);this.paths.add(file.toLowerCase());return file;
 }
 record(entry){
  this.events.set(entry.file,{file:entry.file,type:entry.meta?.importer||'file',uuid:entry.meta?.uuid,reused:!entry.created});
  this.report.resources=[...this.events.values()];this.report.reusedResources=this.report.resources.filter(e=>e.reused).length;this.report.createdResources=this.report.resources.length-this.report.reusedResources;
  return {file:entry.file,meta:entry.meta,reused:!entry.created};
 }
 save(relative,data,meta=null){
  data=Buffer.isBuffer(data)?data:Buffer.from(data);const desired=this.assertSafe(path.join(this.root,relative)),ext=path.extname(desired).toLowerCase(),hash=contentHash(data,ext),signature=meta?metaSignature(meta):null;
  const candidates=(this.byContent.get(ext+':'+hash)||[]).slice().sort((a,b)=>(a.file===desired?-1:b.file===desired?1:0));
  for(const entry of candidates){
   if(meta&&(!entry.signature||entry.signature!==signature||metaIds(entry.meta).some(id=>this.uuidOwners.get(id)?.size!==1)))continue;
   // Re-read candidates so an edited/deleted file or meta cannot produce a stale match.
   try{this.assertSafe(entry.file);const bytes=fs.readFileSync(entry.file);if(contentHash(bytes,ext)!==hash||(ext!=='.prefab'&&!bytes.equals(data)))continue;if(meta){this.assertSafe(entry.file+'.meta');const actual=JSON.parse(fs.readFileSync(entry.file+'.meta','utf8'));if(metaSignature(actual)!==signature||JSON.stringify(metaIds(actual))!==JSON.stringify(metaIds(entry.meta)))continue;entry.meta=actual;}return this.record(entry);}catch(e){}
  }
  // A raw file created by this import may acquire a font meta, but existing files never do.
  const owned=candidates.find(e=>e.created&&!e.meta&&e.file===desired);
  if(meta&&owned&&!fs.existsSync(owned.file+'.meta')){fs.writeFileSync(owned.file+'.meta',JSON.stringify(meta,null,2),{flag:'wx'});owned.meta=meta;owned.signature=signature;for(const id of metaIds(meta)){if(!this.uuidOwners.has(id))this.uuidOwners.set(id,new Set());this.uuidOwners.get(id).add(owned.file);}this.paths.add((owned.file+'.meta').toLowerCase());return this.record(owned);}
  const file=this.freePath(relative,digest(hash+':'+signature));fs.mkdirSync(path.dirname(file),{recursive:true});
  if(meta&&metaIds(meta).some(id=>this.uuidOwners.has(id))){
   const aliases=new Map(),rootId=crypto.randomUUID();function mapIds(m,suffix=''){aliases.set(m.uuid,rootId+suffix);for(const [key,sub]of Object.entries(m.subMetas||{}))mapIds(sub,suffix+'@'+key);}mapIds(meta);
   function replace(value){if(typeof value==='string'&&aliases.has(value))return aliases.get(value);if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value;}meta=replace(meta);
  }
  if(meta?.importer==='prefab')meta={...meta,userData:{...meta.userData,syncNodeName:path.basename(file,'.prefab')}};
  fs.writeFileSync(file,data,{flag:'wx'});if(meta)fs.writeFileSync(file+'.meta',JSON.stringify(meta,null,2),{flag:'wx'});
  return this.record(this.index(file,data,meta,true));
 }
}
function importTarget(project,folder='studio'){
 let relative=String(folder||'studio').trim().replace(/\\/g,'/').replace(/^db:\/\/assets\//,'').replace(/^assets\//,'');
 if(!relative||relative.startsWith('/')||relative.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))throw new Error('导入目录必须是 assets 下的有效相对目录，如 UI/Studio');
 const root=path.join(project,'assets'),output=path.resolve(root,...relative.split('/'));new OutputStoreSafety(root).assertSafe(output);return {folder:relative,output};
}
// Validate the target without indexing the entire Creator assets tree.
class OutputStoreSafety {constructor(root){this.root=path.resolve(root);}assertSafe(file){return OutputStore.prototype.assertSafe.call(this,file);}}
module.exports={OutputStore,importTarget,metaSignature,metaIds,canonical};
