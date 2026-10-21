'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {plan,parseXml,resolveResource,inside}=require('./source');
const {Assets,uuid,write,children}=require('./direct-assets');
const {OutputStore}=require('./output-store');
const attr=(el,k,d='')=>el?.hasAttribute(k)?el.getAttribute(k):d;
const num=(el,k,d=0)=>{const n=Number(attr(el,k,d));return Number.isFinite(n)?n:d;};
const bool=(el,k,d=false)=>String(attr(el,k,d)).toLowerCase()==='true';
const child=(el,name)=>children(el).find(c=>c.tagName===name);
const ref=i=>({__id__:i});
const vec=(x=0,y=0,z=0)=>({__type__:'cc.Vec3',x,y,z});
const color=(el,alpha=255)=>({__type__:'cc.Color',r:num(el,'R',255),g:num(el,'G',255),b:num(el,'B',255),a:alpha});
const borders=el=>bool(el,'Scale9Enable')?{x:num(el,'Scale9OriginX',num(el,'LeftEage')),y:num(el,'Scale9OriginY',num(el,'TopEage')),width:num(el,'Scale9Width'),height:num(el,'Scale9Height'),edges:[num(el,'LeftEage'),num(el,'RightEage'),num(el,'TopEage'),num(el,'BottomEage')]}:[0,0,0,0];
const known=new Set(['GameLayerObjectData','GameNodeObjectData','SingleNodeObjectData','PanelObjectData','ImageViewObjectData','SpriteObjectData','ButtonObjectData','TextObjectData','TextBMFontObjectData','TextFieldObjectData','LoadingBarObjectData','CheckBoxObjectData','ScrollViewObjectData','ListViewObjectData','ProjectNodeObjectData']);
class Prefab {
  constructor(file,assets,report){this.file=file;this.assets=assets;this.report=report;this.a=[{__type__:'cc.Prefab',_name:path.basename(file,'.csd'),_objFlags:0,_native:'',data:ref(1),optimizationPolicy:0,persistent:false}];this.nodes=new Map();this.stack=[];}
  add(o){this.a.push(o);return this.a.length-1;}
  warn(el,reason){this.report.warnings.push({file:this.file,node:attr(el,'Name'),type:attr(el,'ctype'),reason});}
  component(node,type,props={}){const id=this.add({__type__:type,_name:'',_objFlags:0,node:ref(node),_enabled:true,__prefab:null,...props,_id:''});this.a[node]._components.push(ref(id));return id;}
  node(name,parent,size=[0,0],anchor=[0,0],position=[0,0]){
    const id=this.add({__type__:'cc.Node',_name:name,_objFlags:0,_parent:parent===null?null:ref(parent),_children:[],_active:true,_components:[],_prefab:null,_lpos:vec(...position),_lrot:{__type__:'cc.Quat',x:0,y:0,z:0,w:1},_lscale:vec(1,1,1),_layer:33554432,_euler:vec(),_id:''});
    if(parent!==null)this.a[parent]._children.push(ref(id));
    this.nodes.set(id,{size,anchor});
    this.component(id,'cc.UITransform',{_contentSize:{__type__:'cc.Size',width:size[0],height:size[1]},_anchorPoint:{__type__:'cc.Vec2',x:anchor[0],y:anchor[1]}});
    return id;
  }
  overlay(parent,name){const n=this.nodes.get(parent);return this.node(name,parent,n.size,[.5,.5],[(.5-n.anchor[0])*n.size[0],(.5-n.anchor[1])*n.size[1]]);}
  sprite(id,el,data,extra={}){
    const frame=this.assets.frame(data,borders(el));
    if(!frame)return null;
    return this.component(id,'cc.Sprite',{_color:color(child(el,'CColor')),_srcBlendFactor:2,_dstBlendFactor:4,_spriteFrame:frame,_type:bool(el,'Scale9Enable')?1:0,_sizeMode:0,_fillType:0,_fillStart:0,_fillRange:1,_isTrimmedMode:false,...extra});
  }
  label(id,el,text,extra={}){
    const fontData=child(el,'FontResource'),fontPath=attr(fontData,'Path');
    let font=null;
    if(fontPath){font=this.assets.font(fontPath,attr(fontData,'Type'));if(!font)this.warn(el,'位图字体暂回退为系统字体；字距和外观需要检查');}
    const align={HT_Left:0,HT_Center:1,HT_Right:2,VT_Top:0,VT_Center:1,VT_Bottom:2};
    // Creator 3.8.2+ serializes text effects on Label; the old effect components are deprecated.
    const outline=child(el,'OutlineColor'),shadow=child(el,'ShadowColor');
    return this.component(id,'cc.Label',{_string:text,_fontSize:num(el,'FontSize',20),_lineHeight:num(el,'FontSize',20),_fontFamily:'Arial',_isSystemFontUsed:!font,_font:font,_color:color(child(el,'CColor')),_horizontalAlign:align[attr(el,'HorizontalAlignmentType')]??0,_verticalAlign:align[attr(el,'VerticalAlignmentType')]??1,_overflow:1,_enableWrapText:bool(el,'IsCustomSize'),_isBold:bool(el,'IsBold'),_isItalic:bool(el,'IsItalic'),_spacingX:0,
      _enableOutline:bool(el,'OutlineEnabled'),_outlineColor:color(outline,num(outline,'A',255)),_outlineWidth:num(el,'OutlineSize',1),
      _enableShadow:bool(el,'ShadowEnabled'),_shadowColor:color(shadow,num(shadow,'A',255)),_shadowOffset:{__type__:'cc.Vec2',x:num(el,'ShadowOffsetX',2),y:num(el,'ShadowOffsetY',-2)},_shadowBlur:num(el,'ShadowBlurRadius'),...extra});
  }
  button(id,el,type='cc.Button',extra={}){
    const frame=tag=>this.assets.frame(child(el,tag),borders(el));
    const normal=frame(type==='cc.Toggle'?'NormalBackFileData':'NormalFileData');
    const pressed=frame(type==='cc.Toggle'?'PressedBackFileData':'PressedFileData')||normal;
    const disabled=frame(type==='cc.Toggle'?'DisableBackFileData':'DisabledFileData')||normal;
    return this.component(id,type,{_interactable:bool(el,'TouchEnable',true)&&bool(el,'Enabled',true),_transition:normal?2:0,_target:ref(id),_normalSprite:normal,_hoverSprite:normal,_pressedSprite:pressed,_disabledSprite:disabled,clickEvents:[],...extra});
  }
  convert(el,parent=null){
    const type=attr(el,'ctype'),sz=child(el,'Size'),an=child(el,'AnchorPoint'),pos=child(el,'Position'),sc=child(el,'Scale');
    const size=[num(sz,'X'),num(sz,'Y')],anchor=[num(an,'ScaleX'),num(an,'ScaleY')];
    const pn=parent===null?{size:[0,0],anchor:[0,0]}:this.nodes.get(parent);
    const id=this.node(attr(el,'Name','Node'),parent,size,anchor,[num(pos,'X')-pn.anchor[0]*pn.size[0],num(pos,'Y')-pn.anchor[1]*pn.size[1]]),n=this.a[id];
    n._active=bool(el,'VisibleForFrame',true); // Studio's Visible is editor-only; VisibleForFrame is runtime visibility.
    n._lscale=vec(num(sc,'ScaleX',1)*(bool(el,'FlipX')?-1:1),num(sc,'ScaleY',1)*(bool(el,'FlipY')?-1:1),1);
    const rotation=-num(el,'RotationSkewX'),rad=rotation*Math.PI/360;
    n._euler=vec(0,0,rotation);n._lrot={__type__:'cc.Quat',x:0,y:0,z:Math.sin(rad),w:Math.cos(rad)};
    const alpha=num(el,'Alpha',num(child(el,'CColor'),'A',255));if(alpha!==255)this.component(id,'cc.UIOpacity',{_opacity:alpha});
    if(num(el,'RotationSkewX')!==num(el,'RotationSkewY'))this.warn(el,'不等轴倾斜暂按 RotationSkewX 旋转处理');
    if(!known.has(type))this.warn(el,'暂不支持此控件；保留节点和子节点');
    if(attr(el,'UserData')||attr(el,'CallBackName')||attr(el,'CallBackType'))this.warn(el,'自定义数据/回调未绑定；请在 Creator 中连接业务脚本');
    const isScroll=type==='ListViewObjectData'||type==='ScrollViewObjectData';
    if(['PanelObjectData','ScrollViewObjectData','ListViewObjectData'].includes(type)&&num(el,'ComboBoxIndex')>0){
      const bg=this.overlay(id,'Background');
      this.component(bg,'cc.Sprite',{_color:color(child(el,num(el,'ComboBoxIndex')===1?'SingleColor':'FirstColor'),num(el,'BackColorAlpha',255)),_spriteFrame:this.assets.solid(),_sizeMode:0,_type:0});
      if(num(el,'ComboBoxIndex')===2)this.warn(el,'渐变背景暂使用起始颜色');
    }
    if(['SpriteObjectData','ImageViewObjectData','PanelObjectData','ScrollViewObjectData','ListViewObjectData'].includes(type))this.sprite(id,el,child(el,'FileData'));
    if(type==='ButtonObjectData'){
      this.sprite(id,el,child(el,'NormalFileData'));this.button(id,el);
      if(attr(el,'ButtonText'))this.label(this.overlay(id,'Label'),el,attr(el,'ButtonText'),{_color:color(child(el,'TextColor')),_horizontalAlign:1});
    }
    if(type==='TextObjectData'||type==='TextBMFontObjectData'){
      this.label(id,el,attr(el,'LabelText'));
      if(type==='TextBMFontObjectData')this.warn(el,'BMFont 暂回退为系统字体，需手动设置字体');
    }
    if(type==='TextFieldObjectData'){
      const text=this.label(this.overlay(id,'Text'),el,attr(el,'LabelText'));
      const placeholder=this.label(this.overlay(id,'Placeholder'),el,attr(el,'PlaceHolderText'));
      this.component(id,'cc.EditBox',{_textLabel:ref(text),_placeholderLabel:ref(placeholder),_string:attr(el,'LabelText'),_inputFlag:bool(el,'PasswordEnable')?0:5,_inputMode:6,_maxLength:bool(el,'MaxLengthEnable')?num(el,'MaxLengthText',20):-1,_returnType:0});
    }
    if(type==='CheckBoxObjectData'){
      this.sprite(id,el,child(el,'NormalBackFileData'));
      const mark=this.overlay(id,'Checkmark'),markSprite=this.sprite(mark,el,child(el,'NodeNormalFileData'));
      n._active=bool(el,'VisibleForFrame',true);
      this.button(id,el,'cc.Toggle',{_isChecked:bool(el,'CheckedState'),_checkMark:markSprite===null?null:ref(markSprite),checkEvents:[]});
      if(attr(child(el,'NodeDisableFileData'),'Path')!==attr(child(el,'NodeNormalFileData'),'Path'))this.warn(el,'Toggle 保留正常勾选图；禁用勾选图需要手动设置');
    }
    if(type==='LoadingBarObjectData'){
      const reverse=attr(el,'ProgressType')==='Right_To_Left';
      this.sprite(id,el,child(el,'ImageFileData')||child(el,'FileData'),{_type:3,_fillStart:reverse?1:0,_fillRange:(reverse?-1:1)*num(el,'ProgressInfo',100)/100});
    }
    if(bool(el,'ClipAble'))this.component(id,'cc.Mask',{_type:0,_inverted:false});
    if(bool(el,'TouchEnable')&&!['ButtonObjectData','CheckBoxObjectData','TextFieldObjectData'].includes(type)&&!isScroll)this.component(id,'cc.BlockInputEvents');
    // Relative position widgets preserve the initial anchor-space position and resize proportionally.
    const px=bool(el,'PositionPercentXEnabled'),py=bool(el,'PositionPercentYEnabled');
    if(parent!==null&&(px||py)){
      const pre=child(el,'PrePosition');
      this.component(id,'cc.Widget',{_alignFlags:(px?8:0)|(py?4:0),_left:num(pre,'X')-(pn.size[0]?anchor[0]*size[0]/pn.size[0]:0),_bottom:num(pre,'Y')-(pn.size[1]?anchor[1]*size[1]/pn.size[1]:0),_isAbsLeft:false,_isAbsBottom:false,_alignMode:2});
    }
    if(bool(el,'PercentWidthEnable')||bool(el,'PercentHeightEnable')||attr(el,'HorizontalEdge')||attr(el,'VerticalEdge'))this.warn(el,'尺寸百分比/边缘约束暂保留设计时尺寸，需检查屏幕适配');
    let target=id;
    if(isScroll){
      const inner=child(el,'InnerNodeSize'),innerSize=[Math.max(size[0],num(inner,'Width',size[0])),Math.max(size[1],num(inner,'Height',size[1]))];
      // Top-align the initial content. Children retain Studio's bottom-left coordinates.
      target=this.node('Content',id,innerSize,[0,0],[-anchor[0]*size[0],(1-anchor[1])*size[1]-innerSize[1]]);
      const vertical=type==='ListViewObjectData'?attr(el,'DirectionType','Horizontal')==='Vertical':num(el,'ScrollDirectionType',1)!==2;
      const horizontal=type==='ListViewObjectData'?!vertical:num(el,'ScrollDirectionType',1)!==1;
      this.component(id,'cc.ScrollView',{_content:ref(target),horizontal,vertical,elastic:bool(el,'IsBounceEnabled'),inertia:true,brake:.5,cancelInnerEvents:true});
      if(type==='ListViewObjectData')this.warn(el,'列表已转为 ScrollView，保留静态子节点位置；动态项目排列、ItemMargin 和数据绑定需实现');
    }
    if(type==='ProjectNodeObjectData'){
      const nested=attr(child(el,'FileData'),'Path');
      if(nested){if(this.stack.includes(nested))throw new Error(`嵌套 CSD 循环：${[...this.stack,nested].join(' -> ')}`);this.stack.push(nested);const doc=parseXml(resolveResource(this.assets.root,nested).full);const root=doc.getElementsByTagName('ObjectData')[0];if(!root)throw new Error(`嵌套 CSD 无 ObjectData：${nested}`);if(doc.getElementsByTagName('Timeline').length)this.warn(el,`嵌套 CSD ${nested} 的动画未转换`);this.convert(root,id);this.stack.pop();}
    }
    for(const e of children(child(el,'Children')).sort((a,b)=>num(a,'ZOrder')-num(b,'ZOrder')))this.convert(e,target);
    return id;
  }
  build(){
    const doc=parseXml(resolveResource(this.assets.root,this.file).full),root=doc.getElementsByTagName('ObjectData')[0];
    if(!root)throw new Error(`CSD 缺少 ObjectData：${this.file}`);
    this.stack.push(this.file);this.convert(root);this.stack.pop();this.a[1]._name=path.basename(this.file,'.csd');
    const timelines=Array.from(doc.getElementsByTagName('Timeline'));
    if(timelines.length)this.report.warnings.push({file:this.file,reason:`暂未转换 ${timelines.length} 条动画轨道；保留设计时静态状态`});
    for(const [id]of this.nodes){this.a[id]._prefab=ref(this.add({__type__:'cc.PrefabInfo',root:ref(1),asset:ref(0),fileId:uuid(this.file+':'+id)}));}
    return this.a;
  }
}
function validate(prefabs,ids){
  const errors=[];
  for(const {file,data}of prefabs){
    function visit(v){if(!v||typeof v!=='object')return;if('__id__'in v&&(!Number.isInteger(v.__id__)||v.__id__<0||v.__id__>=data.length))errors.push(`${file}: invalid object ${v.__id__}`);if(v.__uuid__&&!ids.has(v.__uuid__))errors.push(`${file}: unresolved asset ${v.__uuid__}`);for(const x of Object.values(v))visit(x);}
    visit(data);
  }
  return errors;
}
function convert(options,progress=()=>{}){
  if(!options.ccs||!options.output)throw new Error('需要 ccs 与 output');
  const output=path.resolve(options.output);
  if(fs.existsSync(output)&&(options.project||options.reuseExisting===false))throw new Error(`为防止覆盖，输出目录必须不存在：${output}`);
  progress({phase:'planning',message:'扫描 CSD 与资源引用'});
  const p=plan(options.ccs,options.selection);
  if(inside(p.resourceRoot,output)||inside(output,p.resourceRoot))throw new Error('输出目录不能与 Studio 资源目录重叠');
  const report={version:require('../package.json').version,mode:'direct',source:p.ccs,selected:p.selected,output,missing:p.missing,warnings:[],prefabs:[],defaultResources:[],resources:[],reusedResources:0,createdResources:0,dependencyErrors:[],phase:'converting'};
  if(p.missing.length){const e=new Error(`缺少 ${p.missing.length} 项资源引用；未创建输出目录`);e.report=report;throw e;}
  progress({phase:'indexing',message:'检查目标目录与已有资源'});
  const assetsRoot=options.project?path.join(output,'assets','studio'):output,store=new OutputStore(assetsRoot,report);
  fs.mkdirSync(output,{recursive:true});
  const reportPath=options.project?path.join(output,'studio-import-report.json'):store.freePath('studio-import-report.json');
  try{
    fs.mkdirSync(assetsRoot,{recursive:true});
    if(options.project)write(path.join(output,'package.json'),{name:path.basename(output).replace(/[^a-z0-9_-]/gi,'-').toLowerCase(),uuid:crypto.randomUUID(),creator:{version:'3.8.8'}});
    const assets=new Assets(p.resourceRoot,assetsRoot,options.namespace||crypto.randomUUID(),report,store),prefabs=[];
    // Preserve only referenced defaults and their dependencies, including source
    // files for components that still need manual adaptation (BMFont, particles).
    for(const file of p.files.filter(f=>f.origin==='default')) {
      report.defaultResources.push({source:file.relative,file:assets.copy(file.relative,'Default')});
    }
    for(let i=0;i<p.csds.length;i++){
      const entry=p.csds[i];progress({phase:'converting',current:i+1,total:p.csds.length,file:entry.path});
      const data=new Prefab(entry.path,assets,report).build(),relative=path.join('prefabs',entry.path.replace(/\.csd$/i,'.prefab')),id=assets.id('prefab:'+entry.path);
      const stored=store.save(relative,JSON.stringify(data,null,2),{ver:'1.1.50',importer:'prefab',imported:false,uuid:id,files:[],subMetas:{},userData:{syncNodeName:path.basename(relative,'.prefab')}}),file=stored.file;
      assets.ids.add(stored.meta.uuid);prefabs.push({file,data});report.prefabs.push({source:entry.path,file,uuid:stored.meta.uuid,reused:stored.reused,nodes:data.filter(x=>x.__type__==='cc.Node').length});
    }
    report.dependencyErrors=validate(prefabs,assets.ids);
    if(report.dependencyErrors.length)throw new Error('生成的资源引用检查失败');
    report.spriteFrames=assets.frames.size;report.phase=report.warnings.length?'complete-with-warnings':'complete';write(reportPath,report);return {...report,reportPath};
  }catch(e){report.phase='failed';report.error=e.stack;write(reportPath,report);e.reportPath=reportPath;throw e;}
}
module.exports={convert,Prefab,validate};
