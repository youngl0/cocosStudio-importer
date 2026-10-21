'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),crypto=require('crypto');
const {unpack}=require('./archive');
function repository(value){
 const raw=String(value||'').trim().replace(/^https:\/\/github\.com\//i,'').replace(/\.git\/?$/i,'').replace(/\/$/,'');
 if(!/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9_.-]+$/i.test(raw)||raw.split('/').some(x=>x==='.'||x==='..'))throw new Error('请填写 GitHub 仓库 owner/repo 或 https://github.com/owner/repo');return raw;
}
function version(value){const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value));if(!m)throw new Error('版本必须是稳定版 x.y.z');const parts=m.slice(1).map(Number);if(parts.some(n=>!Number.isSafeInteger(n)))throw new Error('无效版本号');return parts;}
function compare(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function compatible(current,range){
 version(current);const conditions=String(range||'').trim().split(/\s+/);if(!conditions.length)return false;
 return conditions.every(term=>{const m=/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(term);if(!m)return false;const n=compare(current,m[2]);return {'>=':n>=0,'<=':n<=0,'>':n>0,'<':n<0,'=':n===0}[m[1]||'='];});
}
function request(url,limit=100*1024*1024,redirects=5){
 return new Promise((resolve,reject)=>{
  let target;try{target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||target.port||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(target.hostname))throw new Error('更新下载地址不受支持');}catch(e){reject(e);return;}
  const req=https.get(target,{headers:{'User-Agent':'cocos-studio-importer-updater','Accept':target.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream','X-GitHub-Api-Version':'2022-11-28'}},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(!redirects||!res.headers.location){reject(new Error('更新下载重定向失败'));return;}request(new URL(res.headers.location,target).href,limit,redirects-1).then(resolve,reject);return;}
   if(res.statusCode!==200){res.resume();const error=new Error(res.statusCode===404?'仓库尚无公开 Release，或仓库不可访问':res.statusCode===403||res.statusCode===429?'GitHub 请求受限；可点击「GitHub 发布页」下载安装包手动更新':`GitHub 请求失败（HTTP ${res.statusCode}）`);error.statusCode=res.statusCode;reject(error);return;}
   if(Number(res.headers['content-length'])>limit){res.destroy();reject(new Error('更新下载体积超出限制'));return;}
   const chunks=[];let total=0;res.on('data',data=>{total+=data.length;if(total>limit){res.destroy(new Error('更新下载体积超出限制'));return;}chunks.push(data);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)));
  });req.setTimeout(30000,()=>req.destroy(new Error('更新请求超时，请检查网络后重试')));req.on('error',()=>reject(new Error('无法连接 GitHub，请检查网络后重试')));
 });
}
function feedRelease(raw,{repo,current,name}){
 let feed;try{feed=JSON.parse(raw.toString('utf8'));}catch(e){throw new Error('更新信息文件 update.json 无效');}
 if(!feed||typeof feed!=='object'||Array.isArray(feed))throw new Error('更新信息文件 update.json 无效');
 const latest=version(feed.version).join('.'),tag='v'+latest,asset=`${name}-${latest}.zip`;
 if(feed.schema!==1||feed.name!==name||feed.tag!==tag||feed.asset!==asset||!/^[a-f0-9]{64}$/i.test(feed.sha256||''))throw new Error('更新信息文件的名称、版本或校验值不匹配');
 const prefix=`https://github.com/${repo}/releases/download/${tag}/`;
 return {repo,current,latest,available:compare(latest,current)>0,source:'release-asset',releaseUrl:`https://github.com/${repo}/releases/tag/${tag}`,notes:String(feed.notes||'').slice(0,16000),asset:{name:asset,url:prefix+asset},checksum:prefix+'SHA256SUMS.txt',expectedSha256:feed.sha256.toLowerCase()};
}
async function check({repo,current,name='cocos-studio-importer',fetch=request}){
 repo=repository(repo);version(current);
 // Release assets use github.com, independently of the anonymous REST API quota.
 // Fall back to the API only for older releases that have no feed, or if the asset is unreachable.
 let feed;try{feed=await fetch(`https://github.com/${repo}/releases/latest/download/update.json`,2*1024*1024);}catch(e){}
 if(feed!==undefined)return feedRelease(feed,{repo,current,name});
 const raw=await fetch(`https://api.github.com/repos/${repo}/releases/latest`,2*1024*1024);let release;try{release=JSON.parse(raw.toString('utf8'));}catch(e){throw new Error('GitHub Release 响应无效');}
 if(release.draft||release.prerelease)throw new Error('只支持公开稳定版 Release');const latest=version(release.tag_name).join('.'),expected=`${name}-${latest}.zip`;
 const asset=(release.assets||[]).find(a=>a.name===expected),checksum=(release.assets||[]).find(a=>a.name==='SHA256SUMS.txt');
 const prefix=`https://github.com/${repo}/releases/download/`,page=`https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}`;
 const valid=a=>a&&typeof a.browser_download_url==='string'&&a.browser_download_url.startsWith(prefix)&&!a.browser_download_url.slice(prefix.length).includes('?');
 if(compare(latest,current)>0&&(!valid(asset)||!valid(checksum)))throw new Error(`Release 缺少 ${expected} 或 SHA256SUMS.txt`);
 return {repo,current,latest,available:compare(latest,current)>0,source:'github-api',releaseUrl:page,notes:String(release.body||'').slice(0,16000),asset:valid(asset)?{name:asset.name,url:asset.browser_download_url}:null,checksum:valid(checksum)?checksum.browser_download_url:null};
}
function verifyChecksum(data,text,name){
 const match=String(text).split(/\r?\n/).map(line=>/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim())).find(m=>m&&m[2]===name);
 if(!match||crypto.createHash('sha256').update(data).digest('hex')!==match[1].toLowerCase())throw new Error('更新包 SHA-256 校验失败');
}
function installedRoot(root,allowedRoots){
 root=path.resolve(root);if(!allowedRoots.some(p=>path.resolve(p).toLowerCase()===root.toLowerCase())||fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root).toLowerCase()!==root.toLowerCase())throw new Error('开发目录或符号链接不支持覆盖更新；请先使用 ZIP 安装为项目或全局扩展');return root;
}
async function install({release,root,allowedRoots,current,editorVersion,name='cocos-studio-importer',fetch=request,onProgress=()=>{},rename=fs.renameSync}){
 root=installedRoot(root,allowedRoots);if(!release?.available||compare(release.latest,current)<=0)throw new Error('没有可安装的新版本');
 const target=path.dirname(path.dirname(root)),nonce=crypto.randomUUID(),stage=path.join(target,`.${name}-update-${nonce}`),backup=path.join(target,`.${name}-backups`,`${current}-${nonce}`);
 onProgress('downloading','正在下载更新与校验文件');
 const data=await fetch(release.asset.url),sums=await fetch(release.checksum,1024*1024);verifyChecksum(data,sums,release.asset.name);
 if(release.expectedSha256&&crypto.createHash('sha256').update(data).digest('hex')!==release.expectedSha256)throw new Error('更新包与 update.json 的 SHA-256 不一致');
 onProgress('verifying','校验安装包与编辑器版本');
 try{
  unpack(data,stage);const manifest=JSON.parse(fs.readFileSync(path.join(stage,'package.json'),'utf8'));
  if(manifest.name!==name||manifest.version!==release.latest||manifest.package_version!==2||manifest.main!=='./main.js'||!compatible(editorVersion,manifest.editor))throw new Error('更新包名称、版本或 Creator 兼容范围不匹配');
  for(const file of ['main.js','panel.js','cli.js','lib/direct.js','lib/updater.js','lib/archive.js','vendor/xmldom/lib/index.js'])if(!fs.statSync(path.join(stage,file)).isFile())throw new Error('更新包不完整');
  onProgress('installing','正在备份并安装更新');fs.mkdirSync(path.dirname(backup),{recursive:true});
  rename(root,backup);
  try{rename(stage,root);}catch(error){try{rename(backup,root);}catch(rollback){throw new Error(`安装失败且恢复失败；旧版保留于 ${backup}：${rollback.message}`);}throw error;}
  return {phase:'restart-required',installed:manifest.version,backup,message:'更新已安装。请在「扩展 → 扩展管理器」中重新加载本扩展，或重新打开工程。'};
 }finally{
  // stage is a fresh UUID directory owned by this operation; never remove root or backup.
  if(fs.existsSync(stage)&&path.dirname(stage)===target&&path.basename(stage)===`.${name}-update-${nonce}`)fs.rmSync(stage,{recursive:true,force:true});
 }
}
module.exports={repository,version,compare,compatible,request,check,install,verifyChecksum,installedRoot};
