'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { parseXml, resolveImportResource } = require('./source');
const {OutputStore,metaIds}=require('./output-store');
const children = el => Array.from(el?.childNodes || []).filter(x => x.nodeType === 1);
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
function uuid(seed) {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
function dimensions(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 255 && b[1] === 216) {
    for (let i=2;i+9<b.length;) {
      if(b[i++]!==255) continue;
      const marker=b[i++]; if(marker===216||marker===217) continue;
      const len=b.readUInt16BE(i);
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return [b.readUInt16BE(i+5),b.readUInt16BE(i+3)];
      if(len<2) break; i+=len;
    }
  }
  throw new Error(`图片尺寸读取暂支持 PNG/JPEG：${file}`);
}
function plist(el) {
  if(el.tagName==='dict') {const out={}, c=children(el);for(let i=0;i<c.length;i+=2) out[c[i].textContent]=plist(c[i+1]);return out;}
  if(el.tagName==='array')return children(el).map(plist);
  if(el.tagName==='true'||el.tagName==='false') return el.tagName==='true';
  return /integer|real/.test(el.tagName)?Number(el.textContent):el.textContent;
}
const numbers = value => String(value||'').match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[];
// Atlas frame keys are logical names, not necessarily valid filesystem paths.
function safeFramePath(name) {
  return name.replace(/\\/g,'/').split('/').map(part=>{
    let clean=part.replace(/[<>:"|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'');
    if(!clean)clean='_';
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))clean='_'+clean;
    return clean;
  }).join('/');
}
class Assets {
  constructor(root, out, namespace, report, store) { Object.assign(this,{root,out,namespace,report}); this.store=store||new OutputStore(out,report);this.frames=new Map();this.atlases=new Map();this.ids=new Set(); }
  framePath(relative, hash) {
    return this.store.freePath(path.join('frames',relative),hash);
  }
  id(key) {return uuid(`${this.namespace}:${key}`);}
  copy(relative, type = '') {
    const ref=resolveImportResource(this.root,relative,type);
    return this.store.save(path.join('resources',ref.origin==='default'?'studio-default':'project',ref.relative),fs.readFileSync(ref.full)).file;
  }
  font(relative, type = '') {
    if(!relative) return null;
    const ref=resolveImportResource(this.root,relative,type);
    const id=this.id('resource:'+ref.origin+':'+ref.relative), ext=path.extname(relative).toLowerCase();
    if(!['.ttf','.otf'].includes(ext)){this.copy(relative,type);return null;}
    const result=this.store.save(path.join('resources',ref.origin==='default'?'studio-default':'project',ref.relative),fs.readFileSync(ref.full),{ver:'1.0.1',importer:'ttf-font',imported:false,uuid:id,files:[],subMetas:{},userData:{}});this.ids.add(result.meta.uuid);
    return {__uuid__:result.meta.uuid,__expectedType__:'cc.Font'};
  }
  solid() {
    let file;
    {
      const crc=buf=>{let c=0xffffffff;for(const b of buf){c^=b;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
      const chunk=(type,data)=>{const t=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);t.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,data])),b.length-4);return b;};
      const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
      file=this.store.save('generated/white.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',require('zlib').deflateSync(Buffer.from([0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))])).file;
    }
    return this.frame({getAttribute:k=>k==='Path'?'__solid_white.png':''},[0,0,0,0],file);
  }
  frame(data, borders=[0,0,0,0], generatedFile) {
    if(!data) return null;
    let relative=data.getAttribute('Path'), atlas=data.getAttribute('Plist');
    if(!relative) return null;
    let resourceType=data.getAttribute('Type')||'';
    let atlasRelative='';
    let rect, raw, offset=[0,0], rotated=false;
    if(atlas) {
      const atlasRef=resolveImportResource(this.root,atlas,resourceType), atlasKey=atlasRef.origin+':'+atlasRef.relative;
      atlasRelative=atlasRef.relative;
      if(!this.atlases.has(atlasKey))this.atlases.set(atlasKey,plist(children(parseXml(atlasRef.full).documentElement)[0]));
      const a=this.atlases.get(atlasKey), f=a.frames?.[relative];
      if(!f)throw new Error(`图集 ${atlas} 缺少帧 ${relative}`);
      rect=numbers(f.frame||f.textureRect);raw=numbers(f.sourceSize||f.spriteSourceSize);offset=numbers(f.offset||f.spriteOffset);rotated=!!(f.rotated||f.textureRotated);
      if(rect.length!==4)throw new Error(`暂不支持的图集格式：${atlas}/${relative}`);
      const texture=a.metadata?.textureFileName||a.metadata?.realTextureFileName;
      if(!texture)throw new Error(`图集缺少纹理名：${atlas}`);
      relative=path.posix.join(path.posix.dirname(atlasRef.relative),texture);
      resourceType=atlasRef.origin==='default'?'Default':'';
    }
    const ref=generatedFile?{full:generatedFile,relative,origin:'generated'}:resolveImportResource(this.root,relative,resourceType), [w,h]=dimensions(ref.full);
    rect=rect||[0,0,w,h];raw=raw?.length===2?raw:[rect[2],rect[3]];offset=offset?.length===2?offset:[0,0];
    if(!Array.isArray(borders)){
      const b=borders;
      borders=[Math.max(0,b.x),Math.max(0,raw[0]-b.x-b.width),Math.max(0,b.y),Math.max(0,raw[1]-b.y-b.height)];
      if(b.width<=0||b.height<=0||b.x<0||b.y<0||b.x+b.width>raw[0]||b.y+b.height>raw[1]){
        this.report.warnings.push({resource:relative,reason:'九宫格中心区域超出图片尺寸，已使用并限制边距'});borders=b.edges.map(n=>Math.max(0,n));
      }
    }
    for(const [a,b,size]of [[0,1,raw[0]],[2,3,raw[1]]]){const sum=borders[a]+borders[b];if(sum>size){borders=borders.slice();borders[a]*=size/sum;borders[b]*=size/sum;}}
    const frameName=atlas?data.getAttribute('Path'):'';
    const key=JSON.stringify([ref.origin,ref.relative,rect,raw,offset,rotated,borders,atlasRelative,frameName]);
    if(this.frames.has(key))return this.frames.get(key);
    const id=this.id('frame:'+key);
    // Each image variant owns one frame. This preserves per-widget nine-slice borders
    // without relying on private atlas importer ID generation or external scripts.
    let namedPath=ref.relative;
    if(atlas){
      const safeName=safeFramePath(frameName),frameExt=path.posix.extname(safeName);
      namedPath=path.posix.join('atlases',atlasRelative,frameExt?safeName.slice(0,-frameExt.length)+path.extname(relative):safeName+path.extname(relative));
      if(safeName!==frameName.replace(/\\/g,'/'))this.report.warnings.push({resource:frameName,reason:'图集帧名含文件系统不支持的字符，输出文件名已规范化'});
    }else namedPath=path.posix.join('images',namedPath);
    const dest=path.join(this.out,'frames',ref.origin,namedPath);
    const displayName=path.basename(dest,path.extname(dest));
    const texture=id+'@6c48a', frame=id+'@f9941';
    const meta={ver:'1.0.27',importer:'image',imported:false,uuid:id,files:[],subMetas:{},userData:{type:'sprite-frame',redirect:texture,fixAlphaTransparencyArtifacts:false}};
    meta.subMetas['6c48a']={ver:'1.0.22',importer:'texture',imported:false,uuid:texture,displayName,id:'6c48a',name:'texture',files:[],subMetas:{},userData:{minfilter:'linear',magfilter:'linear',mipfilter:'none',wrapModeS:'clamp-to-edge',wrapModeT:'clamp-to-edge',imageUuidOrDatabaseUri:id,isUuid:true,visible:false}};
    meta.subMetas.f9941={ver:'1.0.12',importer:'sprite-frame',imported:false,uuid:frame,displayName,id:'f9941',name:'spriteFrame',files:[],subMetas:{},userData:{trimType:'custom',trimThreshold:1,rotated,trimX:rect[0],trimY:rect[1],width:rect[2],height:rect[3],rawWidth:raw[0],rawHeight:raw[1],offsetX:offset[0],offsetY:offset[1],borderLeft:borders[0],borderRight:borders[1],borderTop:borders[2],borderBottom:borders[3],imageUuidOrDatabaseUri:texture,isUuid:true,packable:true,pixelsToUnit:100,pivotX:.5,pivotY:.5,meshType:0}};
    const stored=this.store.save(path.relative(this.out,dest),fs.readFileSync(ref.full),meta),storedFrame=stored.meta.subMetas.f9941.uuid;for(const u of metaIds(stored.meta))this.ids.add(u);
    (this.report.images ||= []).push({source:ref.relative,origin:ref.origin,atlas:atlas||undefined,frameName:atlas?data.getAttribute('Path'):undefined,file:stored.file,spriteFrameUuid:storedFrame,reused:stored.reused,rect,rawSize:raw,rotated,borders});
    const result={__uuid__:storedFrame,__expectedType__:'cc.SpriteFrame'};this.frames.set(key,result);return result;
  }
}
module.exports={Assets,uuid,write,children,dimensions};
