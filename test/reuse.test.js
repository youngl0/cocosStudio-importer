'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {convert}=require('../lib/direct'),{defaultRoot}=require('../lib/source'),{OutputStore,importTarget}=require('../lib/output-store');
function fixture(t,body){const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-reuse-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const source=path.join(base,'source'),output=path.join(base,'creator/assets/UI/Studio');fs.mkdirSync(path.join(source,'cocosstudio'),{recursive:true});const ccs=path.join(source,'demo.ccs');fs.writeFileSync(ccs,'<Solution><PropertyGroup Name="demo"/><RootFolder><Project Name="A.csd" Type="Layer"/></RootFolder></Solution>');
 const write=(file,data)=>{const full=path.join(source,'cocosstudio',file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,data);};
 write('A.csd',body||'<GameFile><ObjectData Name="root" ctype="GameLayerObjectData"><Children><AbstractNodeData ctype="ImageViewObjectData"><FileData Path="image.png"/></AbstractNodeData><AbstractNodeData ctype="TextObjectData" LabelText="hello"><FontResource Type="Default" Path="Default/common.ttf"/></AbstractNodeData></Children></ObjectData></GameFile>');write('image.png',fs.readFileSync(path.join(defaultRoot,'Sprite.png')));
 return {base,source,output,ccs,write,run:options=>convert({ccs,output,...options})};}
function snapshot(root){const result={};function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory())visit(full);else if(item.isFile())result[path.relative(root,full)]={data:fs.readFileSync(full),mtime:fs.statSync(full).mtimeMs};}}visit(root);return result;}
function unchanged(root,before){for(const [file,value]of Object.entries(before)){assert.deepEqual(fs.readFileSync(path.join(root,file)),value.data,file);assert.equal(fs.statSync(path.join(root,file)).mtimeMs,value.mtime,file);}}
test('named target permits nested assets paths and rejects traversal, absolute paths and Windows reserved names',t=>{
 const f=fixture(t),project=path.join(f.base,'creator');for(const folder of ['UI/Studio','assets/UI/Studio','db://assets/UI/Studio','UI\\Studio'])assert.equal(importTarget(project,folder).output,f.output);
 for(const folder of ['../outside','UI/../../outside','C:/outside','/outside','UI//a','UI/CON','UI/a.','UI/../a'])assert.throws(()=>importTarget(project,folder),/相对目录|越界/);assert.equal(importTarget(project).folder,'studio');
});
test('reimport reuses image, font and prefab UUIDs and does not rewrite old assets or reports',t=>{
 const f=fixture(t),first=f.run(),before=snapshot(f.output),second=f.run();assert.equal(second.createdResources,0);assert.ok(second.reusedResources>=3);assert.equal(second.prefabs[0].uuid,first.prefabs[0].uuid);assert.equal(second.prefabs[0].file,first.prefabs[0].file);assert.equal(second.images[0].spriteFrameUuid,first.images[0].spriteFrameUuid);assert.ok(second.prefabs[0].reused);assert.notEqual(second.reportPath,first.reportPath);unchanged(f.output,before);
});
test('Creator imported metadata and derived image fields still reuse the same UUID without rewriting meta',t=>{
 const f=fixture(t),first=f.run(),file=first.images[0].file+'.meta',meta=JSON.parse(fs.readFileSync(file));meta.imported=true;meta.files=['.json','.png'];meta.userData.hasAlpha=true;const texture=meta.subMetas['6c48a'],frame=meta.subMetas.f9941;texture.imported=frame.imported=true;texture.files=frame.files=['.json'];texture.userData.anisotropy=0;frame.userData.vertices={rawPosition:[1,2,3]};frame.userData.atlasUuid='';fs.writeFileSync(file,JSON.stringify(meta,null,2));const before=snapshot(f.output),second=f.run();assert.equal(second.images[0].spriteFrameUuid,first.images[0].spriteFrameUuid);assert.equal(second.createdResources,0);unchanged(f.output,before);
});
test('a relocated identical asset in the selected tree keeps its existing filename and UUID',t=>{
 const f=fixture(t),first=f.run(),image=first.images[0].file,renamed=path.join(f.output,'existing/keep-this-name.png');fs.mkdirSync(path.dirname(renamed),{recursive:true});fs.renameSync(image,renamed);fs.renameSync(image+'.meta',renamed+'.meta');const before=snapshot(f.output),second=f.run();assert.equal(second.images[0].file,renamed);assert.equal(second.images[0].spriteFrameUuid,first.images[0].spriteFrameUuid);assert.equal(second.createdResources,0);assert.equal(second.prefabs[0].uuid,first.prefabs[0].uuid);unchanged(f.output,before);
});
test('identical image bytes and settings reuse assets even when source paths differ',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ImageViewObjectData"><FileData Path="image.png"/><Children><AbstractNodeData ctype="ImageViewObjectData"><FileData Path="another/same.png"/></AbstractNodeData></Children></ObjectData></GameFile>');f.write('another/same.png',fs.readFileSync(path.join(defaultRoot,'Sprite.png')));const r=f.run();assert.equal(r.images.length,2);assert.equal(r.images[0].file,r.images[1].file);assert.equal(r.images[0].spriteFrameUuid,r.images[1].spriteFrameUuid);
});
test('same image with different nine-slice or filtering settings is preserved separately',t=>{
 const f=fixture(t),first=f.run(),metaFile=first.images[0].file+'.meta',meta=JSON.parse(fs.readFileSync(metaFile));meta.subMetas['6c48a'].userData.minfilter='nearest';fs.writeFileSync(metaFile,JSON.stringify(meta));const before=snapshot(f.output),second=f.run();assert.notEqual(second.images[0].spriteFrameUuid,first.images[0].spriteFrameUuid);assert.notEqual(second.images[0].file,first.images[0].file);unchanged(f.output,before);
 const third=f.run();assert.equal(third.images[0].file,second.images[0].file);assert.equal(third.createdResources,0);
});
test('changed bytes use a separate image and prefab without UUID collisions even with a repeated namespace',t=>{
 const f=fixture(t),first=f.run({namespace:'fixed'}),before=snapshot(f.output);f.write('image.png',fs.readFileSync(path.join(defaultRoot,'Button_Normal.png')));const second=f.run({namespace:'fixed'});assert.notEqual(second.images[0].spriteFrameUuid,first.images[0].spriteFrameUuid);assert.notEqual(second.prefabs[0].uuid,first.prefabs[0].uuid);assert.notEqual(second.prefabs[0].file,first.prefabs[0].file);assert.deepEqual(second.dependencyErrors,[]);unchanged(f.output,before);const third=f.run();assert.equal(third.createdResources,0);assert.equal(third.images[0].spriteFrameUuid,second.images[0].spriteFrameUuid);assert.equal(third.prefabs[0].uuid,second.prefabs[0].uuid);
});
test('changed prefab content preserves the original and reuses the changed variant on the next import',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="TextObjectData" LabelText="first"/></GameFile>'),first=f.run(),before=snapshot(f.output);f.write('A.csd','<GameFile><ObjectData ctype="TextObjectData" LabelText="second"/></GameFile>');const second=f.run();assert.notEqual(first.prefabs[0].uuid,second.prefabs[0].uuid);unchanged(f.output,before);assert.equal(f.run().prefabs[0].uuid,second.prefabs[0].uuid);
});
test('existing files without compatible metadata are never adopted or overwritten as images',t=>{
 const f=fixture(t),file=path.join(f.output,'frames/project/images/image.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(defaultRoot,'Sprite.png'),file);const before=snapshot(f.output),r=f.run();assert.notEqual(r.images[0].file,file);assert.equal(fs.existsSync(file+'.meta'),false);unchanged(f.output,before);
});
test('ambiguous duplicate UUIDs are not reused',t=>{
 const f=fixture(t),first=f.run(),image=first.images[0].file,duplicate=path.join(f.output,'duplicate.png');fs.copyFileSync(image,duplicate);fs.copyFileSync(image+'.meta',duplicate+'.meta');const before=snapshot(f.output),second=f.run();assert.notEqual(first.images[0].spriteFrameUuid,second.images[0].spriteFrameUuid);unchanged(f.output,before);
});
test('output directory links and nested junctions cannot write outside the chosen directory',t=>{
 const f=fixture(t),outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.mkdirSync(f.output,{recursive:true});fs.symlinkSync(outside,path.join(f.output,'linked'),'junction');assert.throws(()=>new OutputStore(f.output).save('linked/x.txt',Buffer.from('bad')),/符号链接/);assert.equal(fs.existsSync(path.join(outside,'x.txt')),false);fs.symlinkSync(outside,path.join(f.base,'creator/assets/link'),'junction');assert.throws(()=>importTarget(path.join(f.base,'creator'),'link/nested'),/符号链接/);
});
test('changed raw resources and orphaned meta names remain intact',t=>{
 const f=fixture(t);fs.mkdirSync(f.output,{recursive:true});fs.writeFileSync(path.join(f.output,'font.ttf'),'original');fs.writeFileSync(path.join(f.output,'new.ttf.meta'),JSON.stringify({uuid:crypto.randomUUID()}));const before=snapshot(f.output),store=new OutputStore(f.output);const one=store.save('font.ttf',Buffer.from('new'));assert.notEqual(path.basename(one.file),'font.ttf');const two=store.save('new.ttf',Buffer.from('another'));assert.notEqual(path.basename(two.file),'new.ttf');unchanged(f.output,before);
});

test('plain defaults share their preserved files with sprite frames and keep one copy across imports',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ImageViewObjectData"><FileData Type="Default" Path="Default/ImageFile.png"/><Children><AbstractNodeData ctype="ButtonObjectData"><NormalFileData Type="Default" Path="Default/Button_Disable.png"/></AbstractNodeData></Children></ObjectData></GameFile>');
 const first=f.run();assert.equal(first.images.length,2);for(const image of first.images)assert.equal(image.file,first.defaultResources.find(r=>r.source===image.source).file);assert.equal(fs.existsSync(path.join(f.output,'frames/default')),false);
 const files=Object.keys(snapshot(f.output)).filter(p=>/\.png$/.test(p));assert.equal(files.length,2);const before=snapshot(f.output),second=f.run();assert.equal(second.createdResources,0);assert.equal(second.reusedResources,3);assert.equal(second.prefabs[0].uuid,first.prefabs[0].uuid);for(let i=0;i<first.images.length;i++)assert.equal(second.images[i].spriteFrameUuid,first.images[i].spriteFrameUuid);unchanged(f.output,before);
});

test('different default nine-slice settings create only the necessary variants, without a third raw copy',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ImageViewObjectData"><FileData Type="Default" Path="Default/ImageFile.png"/><Children><AbstractNodeData ctype="ImageViewObjectData" Scale9Enable="True" Scale9OriginX="1" Scale9OriginY="1" Scale9Width="8" Scale9Height="8"><FileData Type="Default" Path="Default/ImageFile.png"/></AbstractNodeData></Children></ObjectData></GameFile>');
 const r=f.run();assert.equal(r.images.length,2);assert.notEqual(r.images[0].spriteFrameUuid,r.images[1].spriteFrameUuid);assert.equal(Object.keys(snapshot(f.output)).filter(p=>/\.png$/.test(p)).length,2);assert.equal(r.defaultResources[0].file,r.images[0].file);assert.equal(fs.existsSync(path.join(f.output,'frames/default')),false);assert.equal(f.run().createdResources,0);
});

test('a conflicting default filename keeps the old file and promotes one new copy to an image resource',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ImageViewObjectData"><FileData Type="Default" Path="Default/ImageFile.png"/></ObjectData></GameFile>'),existing=path.join(f.output,'resources/studio-default/Default/ImageFile.png');fs.mkdirSync(path.dirname(existing),{recursive:true});fs.writeFileSync(existing,'user file');const before=snapshot(f.output),r=f.run();assert.notEqual(r.images[0].file,existing);assert.equal(r.images[0].file,r.defaultResources[0].file);assert.equal(Object.keys(snapshot(f.output)).filter(p=>/\.png$/.test(p)).length,2);assert.equal(fs.existsSync(existing+'.meta'),false);unchanged(f.output,before);assert.equal(f.run().createdResources,0);
});

test('a conflicting default font filename does not create separate raw and font copies',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="TextObjectData" LabelText="font"><FontResource Type="Default" Path="Default/common.ttf"/></ObjectData></GameFile>'),existing=path.join(f.output,'resources/studio-default/Default/common.ttf');fs.mkdirSync(path.dirname(existing),{recursive:true});fs.writeFileSync(existing,'user font');const before=snapshot(f.output),r=f.run();assert.equal(Object.keys(snapshot(f.output)).filter(p=>/\.ttf$/.test(p)).length,2);assert.ok(fs.existsSync(r.defaultResources[0].file+'.meta'));unchanged(f.output,before);assert.equal(f.run().createdResources,0);
});

test('generated solid backgrounds attach frame metadata to their single white image',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="PanelObjectData" ComboBoxIndex="1"><Size X="100" Y="80"/><SingleColor R="20" G="30" B="40"/></ObjectData></GameFile>'),r=f.run();assert.equal(r.images.length,1);assert.equal(r.images[0].file,path.join(f.output,'generated/white.png'));assert.equal(Object.keys(snapshot(f.output)).filter(p=>/\.png$/.test(p)).length,1);assert.equal(f.run().createdResources,0);
});
