'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {convert,validate}=require('../lib/direct');
const {resolveResource,plan}=require('../lib/source');
const {parseXml}=require('../lib/source');
const {Assets}=require('../lib/direct-assets');
const {resolveImportResource,defaultRoot}=require('../lib/source');
function fixture(t,body){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-direct-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const resources=path.join(root,'cocosstudio');fs.mkdirSync(resources);const ccs=path.join(root,'test.ccs');
 fs.writeFileSync(ccs,'<Solution><PropertyGroup Name="test" Version="3.10.0.0"/><RootFolder><Project Name="A.csd" Type="Layer"/></RootFolder></Solution>');
 const write=(file,value)=>{const dest=path.join(resources,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,value);};
 write('A.csd',body||'<GameFile><ObjectData ctype="GameLayerObjectData"><Size X="100" Y="80"/><AnchorPoint ScaleX="0.5" ScaleY="0.5"/><Children><AbstractNodeData Name="child" ctype="SingleNodeObjectData"><Size X="20" Y="10"/><Position X="25" Y="30"/></AbstractNodeData></Children></ObjectData></GameFile>');
 const output=path.join(root,'output');return{root,resources,ccs,write,output,run:()=>convert({ccs,output,project:true,namespace:'test'})};
}
test('direct conversion preserves parent anchor coordinates without any editor or plugin',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.resources,'A.csd')),r=f.run(),data=JSON.parse(fs.readFileSync(r.prefabs[0].file));
 const node=data.find(n=>n._name==='child');assert.equal(node._lpos.x,-25);assert.equal(node._lpos.y,-10);assert.equal(r.mode,'direct');assert.deepEqual(r.dependencyErrors,[]);assert.deepEqual(fs.readFileSync(path.join(f.resources,'A.csd')),before);
 assert.throws(f.run,/必须不存在/);
});
test('missing references fail before output creation',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ImageViewObjectData"><FileData Path="missing.png"/></ObjectData></GameFile>');assert.throws(f.run,/缺少/);assert.equal(fs.existsSync(f.output),false);
});

test('text and button effects use modern Label fields with colors, alpha, width and shadow offsets',t=>{
 const effects='OutlineEnabled="True" OutlineSize="3" ShadowEnabled="True" ShadowOffsetX="-4" ShadowOffsetY="6" ShadowBlurRadius="5"';
 const colors='<OutlineColor R="12" G="34" B="56" A="128"/><ShadowColor R="65" G="43" B="21" A="96"/>';
 const f=fixture(t,`<GameFile><ObjectData ctype="GameLayerObjectData"><Children><AbstractNodeData ctype="TextObjectData" LabelText="text" ${effects}>${colors}</AbstractNodeData><AbstractNodeData ctype="ButtonObjectData" ButtonText="button" ${effects}>${colors}</AbstractNodeData></Children></ObjectData></GameFile>`);
 const r=f.run(),a=JSON.parse(fs.readFileSync(r.prefabs[0].file)),labels=a.filter(x=>x.__type__==='cc.Label');
 assert.equal(labels.length,2);assert.equal(a.some(x=>['cc.LabelOutline','cc.LabelShadow'].includes(x.__type__)),false);
 for(const l of labels){assert.equal(l._enableOutline,true);assert.equal(l._outlineWidth,3);assert.deepEqual(l._outlineColor,{__type__:'cc.Color',r:12,g:34,b:56,a:128});assert.equal(l._enableShadow,true);assert.deepEqual(l._shadowColor,{__type__:'cc.Color',r:65,g:43,b:21,a:96});assert.deepEqual(l._shadowOffset,{__type__:'cc.Vec2',x:-4,y:6});assert.equal(l._shadowBlur,5);}
});

test('text effects remain disabled unless enabled and preserve explicit zero values',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="TextObjectData" OutlineEnabled="False" ShadowEnabled="False" OutlineSize="0" ShadowOffsetX="0" ShadowOffsetY="0" ShadowBlurRadius="0"><OutlineColor A="0"/><ShadowColor A="0"/><Children><AbstractNodeData ctype="TextObjectData"/></Children></ObjectData></GameFile>');
 const r=f.run(),labels=JSON.parse(fs.readFileSync(r.prefabs[0].file)).filter(x=>x.__type__==='cc.Label');
 for(const l of labels){assert.equal(l._enableOutline,false);assert.equal(l._enableShadow,false);}
 assert.equal(labels[0]._outlineWidth,0);assert.equal(labels[0]._outlineColor.a,0);assert.equal(labels[0]._shadowColor.a,0);assert.equal(labels[0]._shadowOffset.x,0);assert.equal(labels[0]._shadowOffset.y,0);assert.equal(labels[0]._shadowBlur,0);
 assert.equal(labels[1]._outlineWidth,1);assert.equal(labels[1]._shadowOffset.x,2);assert.equal(labels[1]._shadowOffset.y,-2);
});
test('rejects path traversal and absolute resource references',t=>{
 const f=fixture(t);for(const p of ['../bad','..\\bad','C:/bad','/bad'])assert.throws(()=>resolveResource(f.resources,p),/路径/);
});
test('unknown controls and animation tracks are explicitly reported',t=>{
 const f=fixture(t,'<GameFile><Animation><Timeline Property="Position"/></Animation><ObjectData Name="bone" ctype="ArmatureNodeObjectData"/></GameFile>'),r=f.run();assert.ok(r.warnings.some(w=>w.reason.includes('暂不支持此控件')));assert.ok(r.warnings.some(w=>w.reason.includes('动画轨道')));
});
test('ScrollView receives a separate content node and EditBox label references',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ScrollViewObjectData"><Size X="100" Y="80"/><InnerNodeSize Width="200" Height="300"/><Children><AbstractNodeData Name="edit" ctype="TextFieldObjectData" PlaceHolderText="输入" LabelText="abc"><Size X="40" Y="20"/></AbstractNodeData></Children></ObjectData></GameFile>');
 const r=f.run(),a=JSON.parse(fs.readFileSync(r.prefabs[0].file)),s=a.find(x=>x.__type__==='cc.ScrollView'),e=a.find(x=>x.__type__==='cc.EditBox');assert.equal(a[s._content.__id__]._name,'Content');assert.equal(a[e._textLabel.__id__]._string,'abc');assert.equal(a[e._placeholderLabel.__id__]._string,'输入');
});
test('nested CSD cycles fail with an actionable report instead of infinite recursion',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ProjectNodeObjectData"><FileData Path="A.csd"/></ObjectData></GameFile>');assert.throws(f.run,/循环/);const r=JSON.parse(fs.readFileSync(path.join(f.output,'studio-import-report.json')));assert.equal(r.phase,'failed');
});
test('atlas frames use the atlas texture and preserve rotated rect and per-use slicing',t=>{
 const f=fixture(t);const image=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(image);image.writeUInt32BE(64,16);image.writeUInt32BE(64,20);f.write('sheet.png',image);
 f.write('sheet.plist','<plist><dict><key>frames</key><dict><key>part.png</key><dict><key>frame</key><string>{{8,16},{20,30}}</string><key>sourceSize</key><string>{20,30}</string><key>rotated</key><true/></dict></dict><key>metadata</key><dict><key>textureFileName</key><string>sheet.png</string></dict></dict></plist>');
 f.write('ref.xml','<FileData Path="part.png" Plist="sheet.plist"/>');fs.mkdirSync(f.output);const a=new Assets(f.resources,f.output,'test',{warnings:[]}),el=parseXml(path.join(f.resources,'ref.xml')).documentElement;
 const one=a.frame(el,[1,2,3,4]),two=a.frame(el,[5,6,7,8]);assert.notEqual(one.__uuid__,two.__uuid__);assert.deepEqual(a.frame(el,[1,2,3,4]),one);
 const meta=JSON.parse(fs.readFileSync(a.report.images[0].file+'.meta'));const u=meta.subMetas.f9941.userData;assert.equal(u.rotated,true);assert.equal(u.trimX,8);assert.equal(u.trimY,16);assert.equal(u.width,20);assert.equal(u.height,30);
 assert.equal(path.basename(a.report.images[0].file),'part.png');assert.match(path.basename(a.report.images[1].file),/^part__[a-f0-9]{8}\.png$/);assert.equal(meta.subMetas.f9941.displayName,'part');
});
test('validates graph bounds and all referenced asset UUIDs',()=>{
 assert.equal(validate([{file:'x',data:[{data:{__id__:1}}]}],new Set()).length,1);assert.equal(validate([{file:'x',data:[{asset:{__uuid__:'unknown'}}]}],new Set()).length,1);
});
test('bundled defaults generate sprite frames and copy only referenced files',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="ButtonObjectData"><Size X="46" Y="36"/><NormalFileData Type="Default" Path="Default\\Button_Normal.png"/><PressedFileData Type="Default" Path="Default/Button_Press.png"/><DisabledFileData Type="Default" Path="Default/Button_Disable.png"/></ObjectData></GameFile>');
 const r=f.run(),a=JSON.parse(fs.readFileSync(r.prefabs[0].file)),button=a.find(x=>x.__type__==='cc.Button');
 assert.equal(r.defaultResources.length,3);assert.equal(r.images.length,3);assert.deepEqual(r.dependencyErrors,[]);
 for(const tag of ['_normalSprite','_pressedSprite','_disabledSprite'])assert.ok(button[tag].__uuid__);
 for(const item of r.defaultResources)assert.deepEqual(fs.readFileSync(item.file),fs.readFileSync(path.join(defaultRoot,item.source.slice(8))));
 assert.equal(fs.existsSync(path.join(f.output,'assets/studio/resources/studio-default/Default/common.ttf')),false);
 assert.equal(r.warnings.some(w=>w.reason.includes('内置图片')),false);
});
test('default font, BMFont page, atlas and map dependencies are resolved from the bundle',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="TextObjectData" LabelText="abc"><FontResource Type="Default" Path="Default/common.ttf"/><FileData Type="Default" Path="Default/defaultBMFont.fnt"/><Other Type="Default" Path="Default/DemoPlayer.ExportJson"/><Map Type="Default" Path="Default/defaultMap.tmx"/></ObjectData></GameFile>');
 const p=plan(f.ccs,['A.csd']);assert.deepEqual(p.missing,[]);
 for(const file of ['common.ttf','defaultBMFont.fnt','defaultBMFont.png','DemoPlayer.ExportJson','DemoPlayer0.plist','DemoPlayer0.png','defaultMap.tmx','defaultMap.png'])assert.ok(p.files.some(f=>f.relative==='Default/'+file&&f.origin==='default'),file);
 const r=f.run(),a=JSON.parse(fs.readFileSync(r.prefabs[0].file));assert.ok(a.find(x=>x.__type__==='cc.Label')._font.__uuid__);assert.equal(r.defaultResources.length,8);
});
test('missing bundled defaults are reported before any output is written',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="SpriteObjectData"><FileData Type="Default" Path="Default/not-found.png"/></ObjectData></GameFile>');
 assert.throws(f.run,e=>{assert.equal(e.report.missing[0].origin,'default');assert.equal(e.report.missing[0].from,'A.csd');return /缺少/.test(e.message);});assert.equal(fs.existsSync(f.output),false);
});
test('explicit defaults and project files with the same path have separate identities',t=>{
 const f=fixture(t,'<GameFile><ObjectData ctype="SpriteObjectData"><FileData Type="Default" Path="Default/Sprite.png"/><Children><AbstractNodeData ctype="SpriteObjectData"><FileData Type="Normal" Path="Default/Sprite.png"/></AbstractNodeData></Children></ObjectData></GameFile>');
 f.write('Default/Sprite.png',fs.readFileSync(path.join(defaultRoot,'white.png')));
 const r=f.run();assert.equal(r.images.length,2);assert.deepEqual(new Set(r.images.map(i=>i.origin)),new Set(['default','project']));assert.notEqual(r.images[0].spriteFrameUuid,r.images[1].spriteFrameUuid);
});
test('default resolver handles short names, missing project Default paths and traversal',t=>{
 const f=fixture(t);assert.equal(resolveImportResource(f.resources,'Sprite.png','Default').origin,'default');assert.equal(resolveImportResource(f.resources,'Default/Sprite.png').origin,'default');
 assert.equal(resolveImportResource(f.resources,'Sprite.png').origin,'project');
 for(const p of ['../outside.png','Default/../outside.png','Default/../../outside.png','C:/outside.png'])assert.throws(()=>resolveImportResource(f.resources,p,'Default'),/路径/);
});
test('preserves image names and source directories, reuses identical frames and separates slices',t=>{
 const f=fixture(t);for(const p of ['ui/button.png','icons/button.png'])f.write(p,fs.readFileSync(path.join(defaultRoot,'Sprite.png')));
 const report={warnings:[]},a=new Assets(f.resources,f.output,'test',report),data=p=>({getAttribute:k=>k==='Path'?p:''});
 const one=a.frame(data('ui/button.png')),same=a.frame(data('ui/button.png')),sliced=a.frame(data('ui/button.png'),[1,1,1,1]),other=a.frame(data('icons/button.png'));
 assert.deepEqual(one,same);assert.notEqual(one.__uuid__,sliced.__uuid__);assert.notEqual(one.__uuid__,other.__uuid__);assert.equal(report.images.length,3);
 assert.equal(path.relative(f.output,report.images[0].file).replace(/\\/g,'/'),'frames/project/images/ui/button.png');
 assert.equal(path.relative(f.output,report.images[2].file).replace(/\\/g,'/'),'frames/project/images/icons/button.png');
 assert.match(path.basename(report.images[1].file),/^button__[a-f0-9]{8}\.png$/);
 for(const item of report.images)assert.deepEqual(fs.readFileSync(item.file),fs.readFileSync(path.join(defaultRoot,'Sprite.png')));
});
test('generated suffixes cannot overwrite an existing source-name collision',t=>{
 const f=fixture(t),a=new Assets(f.resources,f.output,'test',{warnings:[]});
 const first=a.framePath('project/images/button.png','12345678abcd');
 const variant=a.framePath('project/images/button.png','abcdef012345');
 const named=a.framePath('project/images/button__abcdef01.png','fedcba987654');
 assert.equal(new Set([first,variant,named]).size,3);assert.equal(path.basename(named),'button__abcdef01__fedcba98.png');
 const upper=a.framePath('project/images/BUTTON.png','77777777abcd');assert.notEqual(first.toLowerCase(),upper.toLowerCase());
});
