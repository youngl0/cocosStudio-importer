'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {pack,unpack}=require('../lib/archive');
const updater=require('../lib/updater');
const repo='youngl0/cocosStudio-importer',name='cocos-studio-importer';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-update-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function bundle(t,options={}){
 const base=fixture(t),source=path.join(base,'source'),root=path.join(base,'project/extensions',name);fs.mkdirSync(source);fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'old.txt'),'keep old version');
 const manifest={name,version:'0.3.1',package_version:2,main:'./main.js',editor:'>=3.8.2 <3.9.0',...options};fs.writeFileSync(path.join(source,'package.json'),JSON.stringify(manifest));
 for(const file of ['main.js','panel.js','cli.js','lib/direct.js','lib/updater.js','lib/archive.js','vendor/xmldom/lib/index.js']){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),'// new version');}
 const data=pack(source),asset=`${name}-0.3.1.zip`,sums=Buffer.from(crypto.createHash('sha256').update(data).digest('hex')+'  '+asset+'\n');
 const release={repo,current:'0.3.0',latest:'0.3.1',available:true,asset:{name:asset,url:'https://github.com/'+repo+'/releases/download/v0.3.1/'+asset},checksum:'https://github.com/'+repo+'/releases/download/v0.3.1/SHA256SUMS.txt'};
 return {base,source,root,data,sums,release,options:{release,root,allowedRoots:[root],current:'0.3.0',editorVersion:'3.8.8',fetch:async url=>url.endsWith('SHA256SUMS.txt')?sums:data}};
}
test('repository parser and numeric stable-version comparisons reject invalid targets',()=>{
 assert.equal(updater.repository('https://github.com/'+repo+'.git'),repo);assert.equal(updater.compare('0.10.0','0.9.9'),1);assert.equal(updater.compare('v0.3.0','0.3.0'),0);
 for(const value of ['https://example.com/a/b','a/../b','a/b?token=abc','a/b/c'])assert.throws(()=>updater.repository(value));
 for(const value of ['0.3.0-beta.1','../0.3.0','01.3.0'])assert.throws(()=>updater.version(value));
 assert.equal(updater.compatible('3.8.8','>=3.8.2 <3.9.0'),true);assert.equal(updater.compatible('3.8.1','>=3.8.2 <3.9.0'),false);assert.equal(updater.compatible('3.9.0','>=3.8.2 <3.9.0'),false);
});
test('check resolves exact release ZIP and checksums and does not downgrade',async()=>{
 const payload={tag_name:'v0.3.1',body:'Fixes',assets:[{name:name+'-0.3.1.zip',browser_download_url:`https://github.com/${repo}/releases/download/v0.3.1/${name}-0.3.1.zip`},{name:'SHA256SUMS.txt',browser_download_url:`https://github.com/${repo}/releases/download/v0.3.1/SHA256SUMS.txt`}]};
 const fetch=async url=>{if(url.endsWith('/download/update.json'))throw Object.assign(new Error('No feed in legacy release'),{statusCode:404});assert.equal(url,`https://api.github.com/repos/${repo}/releases/latest`);return Buffer.from(JSON.stringify(payload));};
 assert.equal((await updater.check({repo,current:'0.3.0',fetch})).available,true);assert.equal((await updater.check({repo,current:'0.3.1',fetch})).available,false);assert.equal((await updater.check({repo,current:'0.4.0',fetch})).available,false);
 payload.assets[0].browser_download_url='https://example.com/update.zip';await assert.rejects(updater.check({repo,current:'0.3.0',fetch}),/缺少/);
 payload.prerelease=true;await assert.rejects(updater.check({repo,current:'0.3.0',fetch}),/稳定版/);
});
test('ZIP round trip preserves names and bytes, refuses collisions and detects CRC damage',t=>{
 const root=fixture(t),source=path.join(root,'source');fs.mkdirSync(path.join(source,'中文'),{recursive:true});fs.writeFileSync(path.join(source,'中文/a.txt'),'你好');fs.writeFileSync(path.join(source,'file.txt'),'Hello');
 const data=pack(source),dest=path.join(root,'dest');assert.deepEqual(pack(source),data);unpack(data,dest);assert.equal(fs.readFileSync(path.join(dest,'中文/a.txt'),'utf8'),'你好');assert.throws(()=>unpack(data,dest),/必须不存在/);
 const damaged=Buffer.from(data),central=damaged.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));damaged[central+16]^=1;assert.throws(()=>unpack(damaged,path.join(root,'damaged')),/校验失败/);assert.equal(fs.existsSync(path.join(root,'damaged')),false);
});
test('ZIP rejects traversal and symlink entries before writing',t=>{
 const root=fixture(t),source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'ok.txt'),'hello');const data=pack(source),central=data.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 const traversal=Buffer.from(data);Buffer.from('../bad').copy(traversal,30);Buffer.from('../bad').copy(traversal,central+46);assert.throws(()=>unpack(traversal,path.join(root,'dest')),/非法路径/);
 const link=Buffer.from(data);link.writeUInt32LE((0xa1ff<<16)>>>0,central+38);assert.throws(()=>unpack(link,path.join(root,'link')),/链接/);assert.equal(fs.existsSync(path.join(root,'dest')),false);
});
test('install verifies checksum then replaces extension and retains a complete backup',async t=>{
 const f=bundle(t),phases=[],result=await updater.install({...f.options,onProgress:phase=>phases.push(phase)});
 assert.equal(result.phase,'restart-required');assert.deepEqual(phases,['downloading','verifying','installing']);assert.equal(fs.readFileSync(path.join(result.backup,'old.txt'),'utf8'),'keep old version');assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'package.json'))).version,'0.3.1');assert.equal(fs.existsSync(path.join(f.root,'old.txt')),false);
});
test('checksum mismatch leaves the installed extension intact',async t=>{
 const f=bundle(t);await assert.rejects(updater.install({...f.options,fetch:async url=>url.endsWith('SHA256SUMS.txt')?Buffer.from('bad checksum'):f.data}),/SHA-256/);assert.equal(fs.readFileSync(path.join(f.root,'old.txt'),'utf8'),'keep old version');
});
test('wrong package identity, version and editor range never replace the old version',async t=>{
 for(const options of [{name:'another-extension'},{version:'0.9.9'},{editor:'>=3.9.0 <4.0.0'}]){const f=bundle(t,options);await assert.rejects(updater.install(f.options),/不匹配/);assert.equal(fs.readFileSync(path.join(f.root,'old.txt'),'utf8'),'keep old version');assert.equal(fs.readdirSync(path.join(f.base,'project')).some(n=>n.includes('-update-')),false);}
});
test('failed replacement restores the previous extension directory',async t=>{
 const f=bundle(t);let calls=0;await assert.rejects(updater.install({...f.options,rename:(from,to)=>{calls++;if(calls===2)throw new Error('Simulated locked target');fs.renameSync(from,to);}}),/locked target/);assert.equal(calls,3);assert.equal(fs.readFileSync(path.join(f.root,'old.txt'),'utf8'),'keep old version');assert.equal(fs.existsSync(path.join(f.root,'package.json')),false);
});
test('development directories and downgrades are blocked before download',async t=>{
 const f=bundle(t),fetch=()=>{throw new Error('Unexpected network');};await assert.rejects(updater.install({...f.options,allowedRoots:[],fetch}),/开发目录/);await assert.rejects(updater.install({...f.options,current:'0.4.0',fetch}),/没有可安装/);
});
test('network fetch rejects arbitrary hosts and non-HTTPS URLs',async()=>{
 for(const url of ['http://github.com/a','https://example.com/a','https://github.com:444/a','https://user:secret@github.com/a'])await assert.rejects(updater.request(url),/不受支持/);
});

test('release feed checks updates while the anonymous GitHub API is rate limited',async()=>{
 const feed={schema:1,name,version:'0.4.1',tag:'v0.4.1',asset:name+'-0.4.1.zip',sha256:'a'.repeat(64),notes:'Fix API rate limits'},calls=[];
 const fetch=async url=>{calls.push(url);if(url.startsWith('https://api.github.com/'))throw Object.assign(new Error('API rate limited'),{statusCode:403});assert.equal(url,`https://github.com/${repo}/releases/latest/download/update.json`);return Buffer.from(JSON.stringify(feed));};
 const result=await updater.check({repo,current:'0.4.0',fetch});assert.equal(result.source,'release-asset');assert.equal(result.available,true);assert.equal(result.latest,'0.4.1');assert.equal(result.expectedSha256,'a'.repeat(64));assert.equal(calls.length,1);assert.equal(result.asset.url,`https://github.com/${repo}/releases/download/v0.4.1/${name}-0.4.1.zip`);
});
test('feed checks recognize the current release and never offer a downgrade',async()=>{
 const feed={schema:1,name,version:'0.4.1',tag:'v0.4.1',asset:name+'-0.4.1.zip',sha256:'a'.repeat(64)},fetch=async()=>Buffer.from(JSON.stringify(feed));
 assert.equal((await updater.check({repo,current:'0.4.1',fetch})).available,false);assert.equal((await updater.check({repo,current:'0.5.0',fetch})).available,false);
});
test('invalid release feed fails closed instead of trusting URLs or a different package',async()=>{
 const feed={schema:1,name,version:'0.4.1',tag:'v0.4.1',asset:name+'-0.4.1.zip',sha256:'a'.repeat(64)};
 for(const changes of [{name:'other-extension'},{version:'0.4.1-beta.1'},{tag:'../other'},{asset:'https://example.com/update.zip'},{sha256:'invalid'},{schema:2}]){let calls=0;await assert.rejects(updater.check({repo,current:'0.4.0',fetch:async()=>{calls++;return Buffer.from(JSON.stringify({...feed,...changes}));}}));assert.equal(calls,1);}
 await assert.rejects(updater.check({repo,current:'0.4.0',fetch:async()=>Buffer.from('null')}),/无效/);
});
test('unreachable feed falls back once to the legacy API and preserves the network error',async()=>{
 const calls=[];await assert.rejects(updater.check({repo,current:'0.4.0',fetch:async url=>{calls.push(url);throw Object.assign(new Error(url.includes('api.github.com')?'GitHub API rate limited':'Feed not available'),{statusCode:url.includes('api.github.com')?403:404});}}),/API rate limited/);assert.equal(calls.length,2);
});
test('release build metadata is consumable by the updater and pins the ZIP SHA-256',async t=>{
 const f=bundle(t),pkg={name,version:'0.3.1',editor:'>=3.8.2 <3.9.0'},hash=crypto.createHash('sha256').update(f.data).digest('hex'),feed=require('../scripts/release').updateManifest(pkg,hash,'Release notes');
 const result=await updater.check({repo,current:'0.3.0',fetch:async()=>Buffer.from(JSON.stringify(feed))});assert.equal(result.expectedSha256,hash);assert.equal(result.notes,'Release notes');assert.equal(result.asset.name,f.release.asset.name);const installed=await updater.install({...f.options,release:result});assert.equal(installed.phase,'restart-required');
});
test('feed hash disagreement aborts installation before touching the existing extension',async t=>{
 const f=bundle(t);await assert.rejects(updater.install({...f.options,release:{...f.release,expectedSha256:'0'.repeat(64)}}),/update.json/);assert.equal(fs.readFileSync(path.join(f.root,'old.txt'),'utf8'),'keep old version');
});
