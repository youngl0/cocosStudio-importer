'use strict';
// Small ZIP reader/writer for our release packages: stored/deflated files, no ZIP64 or links.
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let crc=0xffffffff;for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function safeName(name){
 if(!name||name.includes('\\')||/[:\x00-\x1f]/.test(name)||name.startsWith('/')||name.split('/').some(p=>p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))throw new Error('ZIP 包含非法路径');
 return name;
}
function unpack(buffer,dest){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)throw new Error('无效 ZIP 文件');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||count===65535||count>5000||offset+size!==end)throw new Error('不支持的 ZIP 格式');
 let pos=offset,total=0;const files=[],seen=new Set();
 for(let i=0;i<count;i++){
  if(pos+46>end||buffer.readUInt32LE(pos)!==0x02014b50)throw new Error('无效 ZIP 目录');
  const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),crc=buffer.readUInt32LE(pos+16),packed=buffer.readUInt32LE(pos+20),length=buffer.readUInt32LE(pos+24),n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),local=buffer.readUInt32LE(pos+42),mode=buffer.readUInt32LE(pos+38)>>>16;
  if(pos+46+n+extra+comment>end||flags&1||![0,8].includes(method)||(mode&0xf000)===0xa000)throw new Error('ZIP 包含加密文件、链接或不支持的压缩方式');
  const name=safeName(buffer.subarray(pos+46,pos+46+n).toString('utf8')),key=name.replace(/\/$/,'').toLowerCase();
  if(seen.has(key))throw new Error('ZIP 路径重复');seen.add(key);total+=length;if(total>200*1024*1024||length>100*1024*1024)throw new Error('ZIP 解压体积超出限制');
  if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)throw new Error('无效 ZIP 文件头');
  const localN=buffer.readUInt16LE(local+26),start=local+30+localN+buffer.readUInt16LE(local+28);
  if(start+packed>offset||buffer.subarray(local+30,local+30+localN).toString('utf8')!==name||buffer.readUInt16LE(local+8)!==method)throw new Error('ZIP 文件头不匹配');
  if(!name.endsWith('/')){const body=buffer.subarray(start,start+packed),data=method===8?zlib.inflateRawSync(body,{maxOutputLength:Math.max(1,length)}):body;if(data.length!==length||crc32(data)!==crc)throw new Error('ZIP 文件校验失败');files.push({name,data});}
  pos+=46+n+extra+comment;
 }
 if(pos!==end)throw new Error('ZIP 目录大小不匹配');
 // Validate everything before writing; the caller supplies a new staging directory.
 if(fs.existsSync(dest))throw new Error('ZIP 解压目录必须不存在');
 fs.mkdirSync(dest,{recursive:true});for(const {name,data}of files){const file=path.join(dest,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data,{flag:'wx'});}
 return files.map(f=>f.name);
}
function pack(root){
 const chunks=[],central=[];let offset=0,count=0;
 // File bytes are buffered because extension packages are small (under the download limit).
 function add(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const full=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('发布包不允许符号链接');if(entry.isDirectory()){add(full);continue;}if(!entry.isFile())throw new Error('发布包包含特殊文件');
  const name=Buffer.from(safeName(path.relative(root,full).replace(/\\/g,'/'))),data=fs.readFileSync(full),compressed=zlib.deflateRawSync(data),crc=crc32(data),header=Buffer.alloc(30),record=Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  chunks.push(header,name,compressed);central.push(record,name);offset+=header.length+name.length+compressed.length;count++;
 }}add(root);
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);
}
module.exports={pack,unpack,crc32};
