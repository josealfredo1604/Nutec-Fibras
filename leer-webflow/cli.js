#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ─── @webflow/XscpData → HTML converter ────────────────────────────────

function parseXscpData(data, optimize) {
  const { nodes, styles } = data.payload || data;

  const nodeMap = {};
  for (const n of nodes) nodeMap[n._id] = n;

  const styleMap = {};
  if (styles) {
    for (const k of Object.keys(styles)) {
      const s = styles[k];
      styleMap[s._id] = s;
    }
  }

  const isTextNode = n => n.text === true && n.v !== undefined;
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

  function getTag(n) {
    return n.data && n.data.tag && n.data.tag !== 'block' ? n.data.tag : (n.tag || 'div');
  }

  function getClassNames(classIds) {
    const names = [];
    for (const id of classIds || []) {
      const s = styleMap[id];
      if (s && s.name) names.push(s.name);
    }
    return names;
  }

  function getAttrs(n) {
    const a = {};
    if (n.type === 'Link' && n.data && n.data.link) {
      if (n.data.link.url) a.href = n.data.link.url;
    }
    if (n.data && n.data.attr) {
      for (const [k, v] of Object.entries(n.data.attr)) {
        if (v && v !== '') a[k] = v;
      }
    }
    const cns = getClassNames(n.classes);
    if (cns.length > 0) a.class = cns.join(' ');
    return a;
  }

  function hasMeaningfulAttrs(attrs) {
    for (const k of Object.keys(attrs)) {
      if (k !== 'class' && !k.startsWith('data-') && !k.startsWith('aria-')) return true;
    }
    return false;
  }

  function renderNode(nodeId, depth) {
    const n = nodeMap[nodeId];
    if (!n) return '';
    if (depth > 200) return '';

    if (isTextNode(n)) return escapeHtml(n.v);

    if (n.type === 'HtmlEmbed' && n.data && n.data.embed && n.data.embed.meta && n.data.embed.meta.html) {
      return n.data.embed.meta.html;
    }

    const tag = getTag(n);
    const children = n.children || [];
    const attrs = getAttrs(n);

    if (optimize) {
      const meaningful = hasMeaningfulAttrs(attrs);

      if (children.length === 0 && !meaningful && tag !== 'img' && tag !== 'br' && tag !== 'hr' && tag !== 'input') {
        return '';
      }

      if ((tag === 'div' || tag === 'span') && children.length === 1 && !meaningful) {
        const onlyChild = nodeMap[children[0]];
        if (onlyChild && !isTextNode(onlyChild) && onlyChild.type !== 'Image') {
          return renderNode(children[0], depth + 1);
        }
      }

      if (children.length === 1 && !meaningful) {
        const onlyChild = nodeMap[children[0]];
        if (onlyChild && !isTextNode(onlyChild) && getTag(onlyChild) === tag && !hasMeaningfulAttrs(getAttrs(onlyChild))) {
          nodeMap[nodeId].children = onlyChild.children || [];
          return renderNode(nodeId, depth);
        }
      }
    }

    const attrParts = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (v === true) { attrParts.push(escapeHtml(k)); continue; }
      if (k === 'id' && !v) continue;
      attrParts.push(escapeHtml(k) + '="' + escapeHtml(String(v)) + '"');
    }
    const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';

    if (voidTags.has(tag)) return '<' + tag + attrStr + '>';

    const inner = children.map(cid => renderNode(cid, depth + 1)).join('');
    return '<' + tag + attrStr + '>' + inner + '</' + tag + '>';
  }

  const allChildIds = new Set();
  for (const n of nodes) {
    if (n.children) for (const cid of n.children) allChildIds.add(cid);
  }
  const roots = nodes.filter(n => !allChildIds.has(n._id) && !isTextNode(n) && n.type !== undefined);

  return roots.map(r => renderNode(r._id, 0)).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function countNodes(html) {
  const m = html.match(/<[a-z][^>]*>/gi);
  return m ? m.length : 0;
}

function maxDepth(html) {
  let depth = 0, max = 0;
  for (let i = 0; i < html.length; i++) {
    if (html[i] === '<') {
      if (html[i+1] === '/') { depth--; continue; }
      if (html[i+1] === '!') continue;
      depth++; if (depth > max) max = depth;
    }
  }
  return max;
}

function formatHtml(html) {
  let indent = 0;
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  return html.replace(/(<\/?[a-zA-Z][^>]*>)/g, (m, tag) => {
    const closing = tag.startsWith('</');
    const isVoid = voidTags.has(tag.match(/^<\/?([a-zA-Z]+)/)?.[1] || '');
    if (closing) indent--;
    const r = '\n' + '  '.repeat(Math.max(0, indent)) + tag;
    if (!closing && !isVoid && !tag.endsWith('/>')) indent++;
    return r;
  }).trim();
}

// ─── CLI ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const noOptimize = args.includes('--no-optimize');
const noPretty = args.includes('--no-pretty');
const reverse = args.includes('--reverse') || args.includes('-r');
const inputFile = args.find(a => !a.startsWith('-'));
const optimize = !noOptimize;
const pretty = !noPretty;

if (showHelp) {
  console.log(`
Uso: node cli.js [archivo.json] [opciones]

Convierte JSON @webflow/XscpData (copiado desde Webflow) a HTML.

Opciones:
  --no-optimize     Desactivar optimización DOM
  --no-pretty       No formatear HTML (minificar)
  --reverse, -r     Convertir HTML a XscpData (formato Webflow)
  --help, -h        Mostrar ayuda

Si no se pasa archivo, lee desde stdin.
  `);
  process.exit(0);
}

function processJson(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.error('Error: JSON inválido —', e.message);
    process.exit(1);
  }

  if (!(data.type === '@webflow/XscpData' || (data.payload && data.payload.nodes))) {
    console.error('Error: Formato no reconocido. Se espera @webflow/XscpData.');
    process.exit(1);
  }

  let html = parseXscpData(data, optimize);
  if (!html) {
    console.error('Error: No se pudo generar HTML.');
    process.exit(1);
  }

  html = html.replace(/>\s+</g, '><');
  if (pretty) html = formatHtml(html);

  const nodeCount = countNodes(html);
  const depth = maxDepth(html);
  console.log(html);
  console.error(`\n── Stats ──\nNodos: ${nodeCount} | Profundidad: ${depth} | Tamaño: ${(html.length/1024).toFixed(1)} KB`);
}

if (reverse) {
  console.error('La opción --reverse requiere un navegador (usa index.html en su lugar) o instala jsdom: npm install jsdom');
  process.exit(1);
} else if (inputFile) {
  const raw = fs.readFileSync(path.resolve(inputFile), 'utf-8');
  processJson(raw);
} else {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => raw += chunk);
  process.stdin.on('end', () => processJson(raw));
}
