'use strict';
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('../vendor/xmldom/lib');

function parseXml(file) {
  const text = fs.readFileSync(file, 'utf8');
  return new DOMParser({ onError(level, message) {
    if (level !== 'warning') throw new Error(`${file}: ${message}`);
  } }).parseFromString(text, 'text/xml');
}
function elements(node, name = '*') { return Array.from(node.getElementsByTagName(name)); }
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function resolveResource(root, relative) {
  const name = relative.replace(/\\/g, '/');
  if (!name || path.posix.isAbsolute(name) || /[:\x00]/.test(name)) throw new Error(`非法资源路径：${relative}`);
  const full = path.resolve(root, name);
  if (!inside(root, full)) throw new Error(`资源路径越界：${relative}`);
  if (fs.existsSync(full) && !inside(fs.realpathSync(root), fs.realpathSync(full))) throw new Error(`资源链接越界：${relative}`);
  return { full, relative: path.relative(root, full).replace(/\\/g, '/') };
}
const defaultRoot = path.join(__dirname, '..', 'resources', 'Default');
// Explicit Default references always use the bundled library. Ordinary project
// resources retain precedence; only a missing Default/... path falls back.
function resolveImportResource(root, relative, type = '') {
  const name = relative.replace(/\\/g, '/');
  const isDefault = /^Default\//i.test(name);
  const project = resolveResource(root, name);
  if (type !== 'Default' && (!isDefault || fs.existsSync(project.full))) return { ...project, origin: 'project' };
  const bundled = resolveResource(defaultRoot, isDefault ? name.slice(8) : name);
  return { ...bundled, relative: 'Default/' + bundled.relative, origin: 'default' };
}
function scan(ccs) {
  ccs = path.resolve(ccs);
  if (path.extname(ccs).toLowerCase() !== '.ccs') throw new Error('请选择 Cocos Studio .ccs 工程');
  const doc = parseXml(ccs);
  const property = elements(doc, 'PropertyGroup')[0];
  const root = elements(doc, 'RootFolder')[0];
  if (!property || !root) throw new Error('CCS 缺少 PropertyGroup 或 RootFolder');
  const resourceRoot = path.join(path.dirname(ccs), 'cocosstudio');
  if (!fs.existsSync(resourceRoot)) throw new Error(`资源目录不存在：${resourceRoot}`);
  const projects = [];
  let resourceEntries = 0;
  function visit(node, prefix) {
    for (const child of Array.from(node.childNodes || []).filter(n => n.nodeType === 1)) {
      const name = child.getAttribute('Name') || '';
      if (child.tagName === 'Folder') visit(child, path.posix.join(prefix, name.replace(/\\/g, '/')));
      else if (child.tagName === 'Project') {
        const ref = resolveResource(resourceRoot, path.posix.join(prefix, name.replace(/\\/g, '/')));
        projects.push({ path: ref.relative, type: child.getAttribute('Type') || 'Node', exists: fs.existsSync(ref.full) });
      } else resourceEntries++;
    }
  }
  visit(root, '');
  return { ccs, resourceRoot, name: property.getAttribute('Name'), version: property.getAttribute('Version'), projects, resourceEntries };
}

function plan(ccs, selection) {
  const source = scan(ccs);
  const selected = selection && selection.length ? [...new Set(selection)] : source.projects.map(p => p.path);
  const known = new Map(source.projects.map(p => [p.path, p]));
  const files = new Map(), csds = [], missing = [], warnings = [], types = {};
  const queue = [];
  function add(relative, from, type = '') {
    const ref = resolveImportResource(source.resourceRoot, relative, type);
    const key = ref.origin + ':' + ref.relative;
    if (files.has(key)) return;
    if (!fs.existsSync(ref.full) || !fs.statSync(ref.full).isFile()) { missing.push({ path: ref.relative, from, origin: ref.origin }); return; }
    files.set(key, ref);
    queue.push(ref);
  }
  for (const selectedPath of selected) {
    if (!known.has(selectedPath)) throw new Error(`CCS 未登记此 CSD：${selectedPath}`);
    add(selectedPath, 'CCS');
  }
  for (let i = 0; i < queue.length; i++) {
    const ref = queue[i], ext = path.extname(ref.relative).toLowerCase();
    if (ext === '.csd') {
      const doc = parseXml(ref.full);
      const prop = elements(doc, 'PropertyGroup')[0];
      csds.push({ path: ref.relative, type: prop?.getAttribute('Type') || known.get(ref.relative)?.type || 'Node' });
      for (const el of elements(doc)) {
        const ctype = el.getAttribute('ctype');
        if (ctype && /ObjectData$/.test(ctype)) types[ctype] = (types[ctype] || 0) + 1;
        if (/CheckBox|TextAtlas|Slider|ListView|PageView|Armature|Skeleton/.test(ctype || '')) warnings.push({ file: ref.relative, node: el.getAttribute('Name'), type: ctype, reason: '特殊控件需检查独立转换报告及运行时行为' });
        const skewX = Number(el.getAttribute('RotationSkewX') || 0), skewY = Number(el.getAttribute('RotationSkewY') || 0);
        if (skewX !== skewY) warnings.push({ file: ref.relative, node: el.getAttribute('Name'), reason: '不等轴旋转/倾斜需要人工检查' });
        const plist = el.getAttribute('Plist');
        if (plist) add(plist, ref.relative, el.getAttribute('Type') === 'Default' ? 'Default' : '');
        const resource = el.getAttribute('Path');
        if (resource && !plist) add(resource, ref.relative, el.getAttribute('Type') || '');
        if (el.tagName === 'Timeline' && /Skew|BlendFunc/.test(el.getAttribute('Property') || '')) warnings.push({ file: ref.relative, reason: `动画轨道需要人工适配： ${el.getAttribute('Property')}` });
      }
    } else if (ext === '.plist') {
      const doc = parseXml(ref.full);
      for (const key of elements(doc, 'key')) {
        if (!['textureFileName', 'realTextureFileName', 'textureFileName', 'textureFilename'].includes(key.textContent)) continue;
        let value = key.nextSibling;
        while (value && value.nodeType !== 1) value = value.nextSibling;
        const filename = value?.textContent;
        if (filename) {
          // Particle plists can embed their texture instead of shipping a separate file.
          const embedded = elements(doc, 'key').some(k => k.textContent === 'textureImageData' && k.nextSibling);
          const relative = path.posix.join(path.posix.dirname(ref.relative), filename);
          const type = ref.origin === 'default' ? 'Default' : '';
          if (!embedded || fs.existsSync(resolveImportResource(source.resourceRoot, relative, type).full)) add(relative, ref.relative, type);
        }
      }
    } else if (ext === '.fnt') {
      const text = fs.readFileSync(ref.full, 'utf8');
      for (const match of text.matchAll(/\bfile\s*=\s*["']([^"']+)["']/g)) add(path.posix.join(path.posix.dirname(ref.relative), match[1]), ref.relative, ref.origin === 'default' ? 'Default' : '');
    } else if (ext === '.tmx' || ext === '.tsx') {
      for (const el of elements(parseXml(ref.full))) {
        const file = el.getAttribute('source');
        if (file) add(path.posix.join(path.posix.dirname(ref.relative), file), ref.relative, ref.origin === 'default' ? 'Default' : '');
      }
    } else if (ext === '.exportjson') {
      const data = JSON.parse(fs.readFileSync(ref.full, 'utf8'));
      for (const file of [...(data.config_file_path || []), ...(data.config_png_path || [])]) {
        add(path.posix.join(path.posix.dirname(ref.relative), file), ref.relative, ref.origin === 'default' ? 'Default' : '');
      }
    }
  }
  return { ...source, selected, csds, files: [...files.values()], missing, warnings, types,
    bytes: [...files.values()].reduce((sum, f) => sum + fs.statSync(f.full).size, 0) };
}
const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function stageSource(plan, target, name) {
  if (plan.missing.length) throw new Error(`缺少 ${plan.missing.length} 个引用资源，请先检查报告`);
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('中间工程名只能使用字母、数字、横线或下划线');
  if (fs.existsSync(target)) throw new Error(`暂存目录已存在：${target}`);
  const root = path.join(target, 'cocosstudio');
  fs.mkdirSync(root, { recursive: true });
  const tree = { folders: new Map(), files: [] };
  const csds = new Map(plan.csds.map(p => [p.path, p.type]));
  for (const file of plan.files) {
    const destination = resolveResource(root, file.relative).full;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file.full, destination, fs.constants.COPYFILE_EXCL);
    const parts = file.relative.split('/');
    const leaf = parts.pop(); let folder = tree;
    for (const part of parts) {
      if (!folder.folders.has(part)) folder.folders.set(part, { folders: new Map(), files: [] });
      folder = folder.folders.get(part);
    }
    folder.files.push(csds.has(file.relative) ? `<Project Name="${escapeXml(leaf)}" Type="${escapeXml(csds.get(file.relative))}"/>` : `<Image Name="${escapeXml(leaf)}"/>`);
  }
  function render(folder) { return folder.files.join('\n') + [...folder.folders].map(([name, f]) => `<Folder Name="${escapeXml(name)}">${render(f)}</Folder>`).join('\n'); }
  const ccs = path.join(target, name + '.ccs');
  fs.writeFileSync(ccs, `<Solution><PropertyGroup Name="${name}" Version="3.10.0.0" Type="CocosStudio"/><SolutionFolder><Group ctype="ResourceGroup"><RootFolder Name=".">${render(tree)}</RootFolder></Group></SolutionFolder></Solution>`);
  return ccs;
}
module.exports = { scan, plan, stageSource, resolveResource, resolveImportResource, defaultRoot, inside, parseXml };
