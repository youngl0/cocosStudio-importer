#!/usr/bin/env node
'use strict';
const path=require('path'),fs=require('fs');
const {scan,plan}=require('./lib/source');
const {convert}=require('./lib/direct');
function main(args){
 const command=args.shift();
 if(!command||command==='--help'){console.log('node cli.js scan <project.ccs>\nnode cli.js plan <project.ccs> [CSD ...]\nnode cli.js convert <project.ccs> <new-output-directory> [CSD ...]\nnode cli.js assets <project.ccs> <new-assets-directory> [CSD ...]\nnode cli.js package\nconvert 生成 Creator 3.8 工程；assets 仅生成资源目录。无需安装 Creator 2.x 或旧迁移扩展。');return;}
 if(command==='package'){
  const dest=path.join(__dirname,'dist/cocos-studio-importer-'+require('./package.json').version);
  if(fs.existsSync(dest))throw new Error('打包目录已存在：'+dest);
  fs.mkdirSync(dest,{recursive:true});
  for(const name of ['package.json','package-lock.json','main.js','panel.js','cli.js','lib','vendor','resources','docs','test','scripts','README.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md'])fs.cpSync(path.join(__dirname,name),path.join(dest,name),{recursive:true,errorOnExist:true});
  console.log(dest);return;
 }
 const ccs=args.shift();if(!ccs)throw new Error('缺少 CCS 路径');
 if(command==='scan'){console.log(JSON.stringify(scan(ccs),null,2));return;}
 if(command==='plan'){const p=plan(ccs,args);delete p.files;console.log(JSON.stringify(p,null,2));return;}
 if(!['convert','assets'].includes(command))throw new Error('未知命令：'+command);
 const output=args.shift();const report=convert({ccs,output,selection:args,project:command==='convert'},p=>console.log(JSON.stringify(p)));
 console.log(JSON.stringify({phase:report.phase,prefabs:report.prefabs.length,warnings:report.warnings.length,reportPath:report.reportPath},null,2));
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);if(e.report)console.error(JSON.stringify(e.report,null,2));process.exitCode=1;}}
module.exports={main};
