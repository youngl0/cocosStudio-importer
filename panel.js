'use strict';
const name = 'cocos-studio-importer';
exports.style = `
  :host{display:block;height:100%;padding:16px;box-sizing:border-box;overflow:auto;color:var(--color-normal-contrast-weakest,#ddd);font:13px sans-serif}
  h2{margin:0 0 6px;font-size:18px}p{line-height:1.6;color:#aaa;margin:6px 0 14px}
  label{display:block;margin-top:10px}input[type=text]{box-sizing:border-box;width:100%;padding:7px;background:#222;color:#ddd;border:1px solid #555;border-radius:3px}
  button{padding:6px 12px;margin:8px 6px 8px 0;background:#444;border:1px solid #666;color:white;border-radius:3px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
  #start{background:#346eab}#list{height:190px;overflow:auto;border:1px solid #555;padding:4px}#list label{margin:0;padding:3px;display:flex;gap:6px}#list label:hover{background:#333}
  pre{white-space:pre-wrap;word-break:break-all;background:#222;padding:10px;max-height:155px;overflow:auto}small{color:#aaa}
  #updates{border-top:1px solid #555;margin-top:14px;padding-top:10px}#update-status{white-space:pre-wrap;word-break:break-word}#release-notes{max-height:100px;overflow:auto}
`;
exports.template = `
  <h2>Cocos Studio → Creator 3.8</h2>
  <p>独立解析 CSD，直接生成 Creator 3.8 原生资源。选择界面后，自动包含嵌套 CSD 与引用资源。</p>
  <label>.ccs 工程</label><input id="ccs" type="text" placeholder="选择 Cocos Studio 工程文件"/>
  <button id="browse">选择工程</button><button id="scan">扫描界面</button>
  <label>界面筛选</label><input id="filter" type="text" placeholder="按 CSD 名称筛选"/>
  <button id="all" title="选中所有存在的 CSD，不受筛选条件影响">选择全部</button><button id="filtered">选择筛选结果</button><button id="none">清空选择</button><small id="count">尚未扫描</small>
  <div id="list"></div>
  <label>导入目录（相对于 assets）</label><input id="folder" type="text" value="studio" placeholder="例如 UI/Studio"/>
  <small>可使用已有目录。文件内容和导入设置完全相同时，复用原资源及 UUID；内容不同则另存。</small><br/>
  <button id="start" disabled>导入所选界面</button><button id="report" disabled>打开报告目录</button>
  <small>首次建议选少量界面。动画、特殊控件及动态列表逻辑需要手动适配；业务代码不在导入范围内。</small>
  <pre id="status">就绪</pre>
  <div id="updates"><small id="version"></small><br/>
    <button id="check-update">检查更新</button><button id="install-update" disabled>下载并安装更新</button><button id="release-page">GitHub 发布页</button>
    <p id="update-status">点击「检查更新」获取 GitHub 上的最新稳定版。</p>
    <details><summary>更新说明</summary><pre id="release-notes"></pre></details>
  </div>
`;
exports.$ = Object.fromEntries(['ccs','browse','scan','filter','all','filtered','none','count','list','start','report','status','folder','version','check-update','install-update','release-page','update-status','release-notes'].map(id => [id, '#' + id]));
exports.ready = async function () {
  const panel = this;
  let projects = [], selection = new Set(), busy = false, updateBlocked=false, reportPath;
  const request = (message, ...args) => Editor.Message.request(name, message, ...args);
  const showError = error => { panel.$.status.textContent = error.message || String(error); };
  const render = () => {
    panel.$.list.textContent = '';
    const filter = panel.$.filter.value.toLowerCase();
    for (const project of projects.filter(p => p.path.toLowerCase().includes(filter))) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      input.type = 'checkbox'; input.checked = selection.has(project.path); input.disabled = busy || !project.exists;
      text.textContent = project.path + (project.exists ? '' : '（文件缺失）');
      input.addEventListener('change', () => { input.checked ? selection.add(project.path) : selection.delete(project.path); updateCount(); });
      label.append(input, text); panel.$.list.append(label);
    }
    updateCount();
  };
  function updateCount() {
    panel.$.count.textContent = `${selection.size} / ${projects.length} 已选`; panel.$.start.disabled = busy || updateBlocked || selection.size === 0;
    panel.$.all.disabled = busy || !projects.some(p => p.exists);
    panel.$.filtered.disabled = busy || !projects.some(p => p.exists && p.path.toLowerCase().includes(panel.$.filter.value.toLowerCase()));
    panel.$.none.disabled = busy || selection.size === 0;
  }
  const showUpdate=state=>{
    const active=['checking','downloading','verifying','installing'].includes(state.phase);
    updateBlocked=active||state.phase==='restart-required';updateCount();
    panel.$.version.textContent=`当前版本 ${state.current}${state.installed?'；已安装 '+state.installed+'，等待重新加载':''}`;
    panel.$['check-update'].disabled=active||state.phase==='restart-required';
    panel.$['install-update'].disabled=active||busy||state.importing||!state.available||state.phase==='restart-required'||!['available','failed'].includes(state.phase);
    panel.$['update-status'].textContent=[state.message||'点击「检查更新」获取 GitHub 上的最新稳定版。',state.error,state.backup&&'旧版本备份：'+state.backup].filter(Boolean).join('\n');
    panel.$['release-notes'].textContent=state.notes||'';
  };
  panel.$['check-update'].addEventListener('click',async()=>{panel.$['check-update'].disabled=true;try{showUpdate(await request('check-update'));}catch(e){panel.$['update-status'].textContent=e.message;panel.$['check-update'].disabled=false;}});
  panel.$['install-update'].addEventListener('click',async()=>{
    panel.$['install-update'].disabled=true;
    try{
      showUpdate(await request('install-update'));
    }catch(e){panel.$['update-status'].textContent=e.message;showUpdate(await request('update-status'));}
  });
  panel.$['release-page'].addEventListener('click',()=>require('electron').shell.openExternal('https://github.com/youngl0/cocosStudio-importer/releases'));
  try{showUpdate(await request('update-status'));}catch(e){panel.$['update-status'].textContent=e.message;}
  async function doScan() {
    try {
      const result = await request('scan', panel.$.ccs.value);
      projects = result.projects; selection.clear(); render();
      panel.$.status.textContent = `${result.name} / Studio ${result.version}\n${projects.length} 个 CSD；请选择需要导入的界面。`;
    } catch (error) { showError(error); }
  }
  panel.$.browse.addEventListener('click', async () => {
    try { const result = await Editor.Dialog.select({ title: '选择 Cocos Studio 工程', type: 'file', filters: [{ name: 'Cocos Studio', extensions: ['ccs'] }] }); if (result.filePaths?.[0]) { panel.$.ccs.value = result.filePaths[0]; await doScan(); } } catch (e) { showError(e); }
  });
  panel.$.scan.addEventListener('click', doScan);
  panel.$.filter.addEventListener('input', render);
  panel.$.all.addEventListener('click', () => { if (busy) return; for (const p of projects) if (p.exists) selection.add(p.path); render(); });
  panel.$.filtered.addEventListener('click', () => { if (busy) return; for (const p of projects) if (p.exists && p.path.toLowerCase().includes(panel.$.filter.value.toLowerCase())) selection.add(p.path); render(); });
  panel.$.none.addEventListener('click', () => { if (busy) return; selection.clear(); render(); });
  panel.$.start.addEventListener('click', async () => {
    busy = true; render();
    try { await request('start', { ccs: panel.$.ccs.value, selection: [...selection],folder:panel.$.folder.value }); }
    catch (e) { busy = false; render(); showError(e); }
  });
  panel.$.report.addEventListener('click', () => { if (reportPath) require('electron').shell.showItemInFolder(reportPath); });
  this._poll = setInterval(async () => {
    try {
      showUpdate(await request('update-status'));
      const state = await request('status');
      if (state.phase === 'idle') return;
      const active = !['complete','complete-with-warnings','failed'].includes(state.phase);
      if (busy !== active) { busy = active; render(); }
      for (const id of ['browse','scan','folder']) panel.$[id].disabled = busy;
      reportPath = state.reportPath; panel.$.report.disabled = !reportPath;
      panel.$.status.textContent = [state.phase, state.detail, state.current && `${state.current}/${state.total}`, state.file, state.message, state.error, reportPath && `报告：${reportPath}`].filter(Boolean).join('\n');
    } catch (e) { showError(e); }
  }, 1000);
};
exports.close = function () { clearInterval(this._poll); };
