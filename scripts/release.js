'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),os=require('os');
const {pack,unpack}=require('../lib/archive');
const root=path.resolve(__dirname,'..'),manifest=require('../package.json');
function check(){
 const lock=require('../package-lock.json');assert.equal(lock.version,manifest.version);assert.equal(lock.packages[''].version,manifest.version);
 assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.equal(manifest.repository.url,'https://github.com/youngl0/cocosStudio-importer.git');
 if(process.env.GITHUB_REF_TYPE==='tag')assert.equal(process.env.GITHUB_REF_NAME,'v'+manifest.version,'Tag must match package.json version');
 assert.ok(fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8').includes('## '+manifest.version));
 const defaults=JSON.parse(fs.readFileSync(path.join(root,'resources/default-resources.json'),'utf8'));
 for(const item of defaults.files){const data=fs.readFileSync(path.join(root,'resources/Default',item.path));assert.equal(data.length,item.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256,item.path);}
 console.log('Manifest, tag, changelog and bundled resources verified.');
}
function release(){
 check();const dest=path.join(root,'dist',`${manifest.name}-${manifest.version}`),archive=dest+'.zip';
 if(fs.existsSync(dest)||fs.existsSync(archive))throw new Error('发布目录已存在；请使用新版本或干净工作副本');
 require('../cli').main(['package']);const data=pack(dest);fs.writeFileSync(archive,data,{flag:'wx'});
 const sums=crypto.createHash('sha256').update(data).digest('hex')+'  '+path.basename(archive)+'\n';fs.writeFileSync(path.join(root,'dist/SHA256SUMS.txt'),sums);
 const changes=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'),section=changes.split('## '+manifest.version)[1].split(/\n## /)[0].trim();fs.writeFileSync(path.join(root,'dist/RELEASE_NOTES.md'),section+'\n');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-release-'));try{const files=unpack(data,path.join(temp,'package'));assert.ok(files.includes('package.json'));assert.ok(files.includes('lib/updater.js'));assert.equal(files.some(f=>/^(node_modules|reports|\.work|bridge-2x)\//.test(f)),false);assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'package/package.json'))).version,manifest.version);}finally{fs.rmSync(temp,{recursive:true,force:true});}
 console.log(archive+'\n'+sums.trim());
}
if(require.main===module){try{process.argv.includes('--check')?check():release();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={check,release};
