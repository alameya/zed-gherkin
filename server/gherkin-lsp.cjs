// gherkin-lsp — zero-dependency LSP server for Gherkin (.feature) files with
// behave (Python) step-definition glue. Single file, Node stdio.
//
// Supported:
//   - textDocument/publishDiagnostics  (undefined step detection)
//   - textDocument/completion          (step suggestions from glue)
//   - textDocument/definition          (step -> glue file/line)
//   - textDocument/documentSymbol      (feature/rule/scenario outline)
//   - textDocument/formatting          (trim, align data tables)
//
// Configuration (workspace/configuration section "gherkin", or
// initialization_options): { "features": [glob...], "glue": [glob...] }
// Globs are resolved against the LSP rootUri (falling back to cwd).
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- keywords ---

// Gherkin i18n (subset: en, ru, de, fr, es). Enough for line parsing; step
// matching itself is keyword-agnostic.
const KEYWORDS = {
  en: {
    section: ['Feature', 'Background', 'Scenario', 'Rule'],
    outline: ['Scenario Outline', 'Scenario Template', 'Examples'],
    step: ['Given', 'When', 'Then', 'And', 'But', '*'],
  },
  ru: {
    section: ['Функциональность', 'Функция', 'Предыстория', 'Сценарий', 'Правило'],
    outline: ['Структура сценария', 'Шаблон сценария', 'Примеры'],
    step: ['Допустим', 'Пусть', 'Если', 'Когда', 'Тогда', 'Затем', 'И', 'Но', 'А', 'Также', '*'],
  },
  de: {
    section: ['Funktionalität', 'Grundlage', 'Szenario', 'Rule'],
    outline: ['Szenariogrundriss', 'Beispiele'],
    step: ['Angenommen', 'Gegeben sei', 'Wenn', 'Dann', 'Und', 'Aber', '*'],
  },
  fr: {
    section: ['Fonctionnalité', 'Contexte', 'Scénario', 'Règle'],
    outline: ['Plan du scénario', 'Modèle de scénario', 'Exemples'],
    step: ['Soit', 'Etant donné', 'Quand', 'Alors', 'Et', 'Mais', '*'],
  },
  es: {
    section: ['Característica', 'Antecedentes', 'Escenario', 'Regla'],
    outline: ['Esquema del escenario', 'Ejemplos'],
    step: ['Dado', 'Dada', 'Cuando', 'Entonces', 'Y', 'Pero', '*'],
  },
};

// ------------------------------------------------------------------- state ---

const state = {
  rootPath: process.cwd(),
  settings: { features: ['**/*.feature'], glue: ['**/steps/*.py'] },
  documents: new Map(), // uri -> text
  glueSteps: [],        // {uri, line, keyword, expression, regex}
  nextId: 1,
};

// ------------------------------------------------------------- gherkin parse ---

function localeOf(line) {
  const m = /^#\s*language:\s*(\S+)/.exec(line);
  return (m && KEYWORDS[m[1]]) || KEYWORDS.en;
}
/** Parses a .feature document into { symbols, steps }.
 * steps: [{ line (0-based), keyword, text, kind ('given'|'when'|'then'|'and'|'step') }]
 */
function parseFeature(text) {
  const lines = text.split(/\r?\n/);
  const symbols = [];
  const steps = [];
  let kw = KEYWORDS.en;
  let inDocstring = false;
  let docDelim = null;
  let lastStepKind = 'given';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (inDocstring) {
      if (line.startsWith(docDelim)) { inDocstring = false; docDelim = null; }
      continue;
    }
    if (!line || line.startsWith('#')) {
      const lm = /^#\s*language:\s*(\S+)/.exec(line);
      if (lm) kw = KEYWORDS[lm[1]] || kw;
      continue;
    }
    if (line.startsWith('"""') || line.startsWith('```')) {
      inDocstring = true;
      docDelim = line.slice(0, 3);
      continue;
    }

    const section = kw.section.concat(kw.outline).find((k) => line.startsWith(k + ':'));
    if (section) {
      const name = line.slice(section.length + 1).trim();
      const kind = kw.outline.includes(section) || section === 'Examples' ? 'namespace' : section === 'Rule' ? 'package' : 'object';
      symbols.push({ name: name || section, kind, range: lineRange(i), selectionRange: lineRange(i), line: i });
      lastStepKind = 'given';
      continue;
    }

    const stepKw = kw.step.find((k) => line === k || line.startsWith(k + ' '));
    if (stepKw) {
      const text = line.slice(stepKw.length).trim();
      let kind = 'step';
      if (/^(given|допустим|пусть|если|angenommen|gegeben|soit|etant donné|dado|dada)/i.test(stepKw)) kind = 'given';
      else if (/^(when|когда|wenn|quand)/i.test(stepKw)) kind = 'when';
      else if (/^(then|тогда|затем|dann|alors|entonces)/i.test(stepKw)) kind = 'then';
      if (kind === 'step') kind = lastStepKind; // And/But/* inherit
      lastStepKind = kind;
      steps.push({ line: i, keyword: stepKw, text, kind });
    }
  }
  return { symbols, steps };
}

function firstMeaningful(lines) {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && !t.startsWith('#')) return i + 1; // language directive may precede
  }
  return 0;
}

function lineRange(line) {
  return { start: { line, character: 0 }, end: { line, character: 0 } };
}

// --------------------------------------------------------------- glue parse ---

const DECORATOR_RE = /^\s*@(given|when|then|step)\s*\(\s*([rbfuRBFU]{0,2})(['"])([\s\S]*?)(?<!\\)\3/g;

function unescapePython(s) {
  return s.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '0': '\0' }[c] ?? c));
}

/** Collects behave step definitions from a python source. */
function parseGlue(text, uri) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    DECORATOR_RE.lastIndex = 0;
    let m = DECORATOR_RE.exec(line);
    if (!m) continue;
    const keyword = m[1].toLowerCase();
    const prefix = m[2]; // string prefix chars (r, b, f, u...)
    const raw = prefix.toLowerCase().includes('r');
    const expr = raw ? m[4] : unescapePython(m[4]);
    let regex = null;
    try { regex = new RegExp('^(?:' + expr + ')$'); } catch { regex = null; }
    found.push({ uri, line: i, keyword, expression: expr, regex });
  }
  return found;
}

function matchStep(stepText) {
  return state.glueSteps.find((d) => d.regex && d.regex.test(stepText));
}

// ------------------------------------------------------------------- files ---

function walk(dir, out, depth) {
  if (depth > 12 || out.length > 20000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
}

function globToRe(glob) {
  const src = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + src + '$');
}

function scanFiles(globs) {
  const all = [];
  walk(state.rootPath, all, 0);
  const res = globs.map((g) => {
    const neg = g.startsWith('!');
    const re = globToRe(neg ? g.slice(1) : g);
    return { re, neg };
  });
  return all.filter((p) => {
    const rel = path.relative(state.rootPath, p).split(path.sep).join('/');
    const keep = res.some(({ re }) => re.test(rel));
    const drop = res.some(({ re, neg }) => neg && re.test(rel));
    return keep && !drop;
  });
}

function reindex(log) {
  state.glueSteps = [];
  const featureFiles = scanFiles(state.settings.features || []);
  const glueFiles = scanFiles(state.settings.glue || []);
  for (const f of glueFiles) {
    try { state.glueSteps.push(...parseGlue(fs.readFileSync(f, 'utf8'), pathToUri(f))); } catch {}
  }
  if (log) {
    console.error(`[gherkin-lsp] indexed: ${featureFiles.length} feature(s), ${glueFiles.length} glue file(s), ${state.glueSteps.length} step definition(s)`);
    console.error(`[gherkin-lsp] root: ${state.rootPath}`);
  }
  for (const uri of state.documents.keys()) refreshDiagnostics(uri);
}

function pathToUri(p) {
  return 'file://' + (p.startsWith('/') ? p : '/' + p);
}
function uriToPath(u) {
  return u.replace(/^file:\/\//, '');
}

// ------------------------------------------------------------- diagnostics ---

function refreshDiagnostics(uri) {
  const text = state.documents.get(uri);
  if (!text || !uri.endsWith('.feature')) return;
  const { steps } = parseFeature(text);
  const diagnostics = [];
  for (const s of steps) {
    if (!matchStep(s.text)) {
      const start = s.keyword.length + 1;
      diagnostics.push({
        severity: 2, // warning
        range: { start: { line: s.line, character: start }, end: { line: s.line, character: start + s.text.length } },
        message: 'Undefined step: ' + s.text,
        source: 'gherkin-lsp',
      });
    }
  }
  sendNotification('textDocument/publishDiagnostics', { uri, diagnostics });
}

// --------------------------------------------------------------- formatting ---

function formatFeature(text) {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/);
  const out = lines.map((l) => l.replace(/\s+$/, ''));
  // align consecutive table rows
  let i = 0;
  while (i < out.length) {
    if (out[i].trim().startsWith('|')) {
      let j = i;
      while (j < out.length && out[j].trim().startsWith('|')) j++;
      const block = out.slice(i, j).map((l) => l.trim().replace(/\|\s+/g, '| ').replace(/\s+\|/g, ' |'));
      const cols = Math.max(...block.map((l) => l.split('|').length - 2));
      const widths = new Array(cols).fill(0);
      for (const l of block) {
        l.split('|').slice(1, -1).forEach((cell, k) => { widths[k] = Math.max(widths[k], cell.trim().length); });
      }
      for (let b = 0; b < block.length; b++) {
        const cells = block[b].split('|').slice(1, -1).map((c) => c.trim());
        block[b] = '| ' + cells.map((c, k) => c.padEnd(widths[k])).join(' | ') + ' |';
      }
      for (let b = 0; b < block.length; b++) out[i + b] = leading(lines[i + b]) + block[b];
      i = j;
    } else i++;
  }
  return out;
}
function leading(s) { const m = /^[ \t]*/.exec(s); return m ? m[0].replace(/\t/g, '  ') : ''; }

// -------------------------------------------------------------- lsp plumbing ---

let buf = Buffer.alloc(0);
const pendingRequests = new Map(); // our request id -> handler(result)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx < 0) break;
    const m = /Content-Length: (\d+)/.exec(buf.subarray(0, idx).toString());
    if (!m) { buf = buf.subarray(idx + 4); continue; }
    const len = parseInt(m[1], 10);
    if (buf.length < idx + 4 + len) break;
    const msg = JSON.parse(buf.subarray(idx + 4, idx + 4 + len).toString());
    buf = buf.subarray(idx + 4 + len);
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const cb = pendingRequests.get(msg.id);
      if (cb) { pendingRequests.delete(msg.id); cb(msg.result, msg.error); continue; }
    }
    handle(msg).catch((e) => console.error('[gherkin-lsp] handler error:', e));
  }
});

function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, message) { send({ jsonrpc: '2.0', id, error: { code: -32603, message } }); }
function sendNotification(method, params) { send({ jsonrpc: '2.0', method, params }); }
function request(method, params, onResult) {
  const id = state.nextId++;
  if (onResult) pendingRequests.set(id, onResult);
  send({ jsonrpc: '2.0', id, method, params });
  return id;
}

let reindexTimer = null;
function reindexSoon(log) {
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => reindex(log), 200);
}

async function handle(msg) {
  if (msg.id !== undefined && msg.result !== undefined) return; // our own request replies

  switch (msg.method) {
    case 'initialize': {
      const opts = msg.params.initializationOptions || {};
      const rootUri = msg.params.rootUri;
      if (rootUri) state.rootPath = uriToPath(rootUri);
      else if (msg.params.rootPath) state.rootPath = msg.params.rootPath;
      if (opts.features || opts.glue) state.settings = { ...state.settings, ...opts };
      reply(msg.id, {
        capabilities: {
          textDocumentSync: 1, // full
          completionProvider: { triggerCharacters: [' '] },
          definitionProvider: true,
          documentSymbolProvider: true,
          documentFormattingProvider: true,
          workspace: {
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: false },
          },
        },
        serverInfo: { name: 'gherkin-lsp', version: '0.1.0' },
      });
      return;
    }
    case 'initialized': {
      request('workspace/configuration', { items: [{ scopeUri: null, section: 'gherkin' }] }, (result) => {
        const s = Array.isArray(result) ? result[0] : result;
        if (s && (s.features || s.glue)) state.settings = { ...state.settings, ...s };
        reindex(true);
      });
      // Watch glue files so edits to step definitions refresh diagnostics.
      request('client/registerCapability', {
        registrations: [{
          id: 'gherkin-glue-watch',
          method: 'workspace/didChangeWatchedFiles',
          registerOptions: { watchers: [{ globPattern: '**/*.py' }] },
        }],
      });
      return;
    }
    case 'workspace/didChangeWatchedFiles': {
      const touched = (msg.params.changes || []).some((c) => c.uri.endsWith('.py'));
      if (touched) reindexSoon(false);
      return;
    }
    case 'workspace/didChangeConfiguration': {
      const s = msg.params.settings?.gherkin || msg.params.settings?.cucumber || msg.params.settings;
      if (s && (s.features || s.glue)) state.settings = { ...state.settings, ...s };
      reindex(true);
      return;
    }
    case 'textDocument/didOpen': {
      state.documents.set(msg.params.textDocument.uri, msg.params.textDocument.text);
      reindexSoon(false);
      refreshDiagnostics(msg.params.textDocument.uri);
      return;
    }
    case 'textDocument/didChange': {
      const changes = msg.params.contentChanges;
      const last = changes[changes.length - 1];
      if (last && last.range === undefined) state.documents.set(msg.params.textDocument.uri, last.text);
      refreshDiagnostics(msg.params.textDocument.uri);
      return;
    }
    case 'textDocument/didClose': {
      state.documents.delete(msg.params.textDocument.uri);
      return;
    }
    case 'textDocument/completion': {
      const items = state.glueSteps.map((d) => ({
        label: d.expression,
        kind: 14, // keyword
        detail: d.keyword + ' (' + path.basename(uriToPath(d.uri)) + ':' + (d.line + 1) + ')',
        data: { uri: d.uri, line: d.line },
      }));
      reply(msg.id, { isIncomplete: false, items });
      return;
    }
    case 'textDocument/definition': {
      const uri = msg.params.textDocument.uri;
      const text = state.documents.get(uri) || '';
      const lineNo = msg.params.position.line;
      const { steps } = parseFeature(text);
      const s = steps.find((st) => st.line === lineNo);
      if (s) {
        const d = matchStep(s.text);
        if (d) {
          reply(msg.id, { uri: d.uri, range: lineRange(d.line) });
          return;
        }
      }
      reply(msg.id, null);
      return;
    }
    case 'textDocument/documentSymbol': {
      const text = state.documents.get(msg.params.textDocument.uri) || '';
      const { symbols } = parseFeature(text);
      const tree = [];
      const stack = [];
      for (const s of symbols) {
        while (stack.length && stack[stack.length - 1].indent >= indentOf(text, s.line)) { stack.pop(); }
        const node = { name: s.name, kind: symKind(s.kind), range: s.range, selectionRange: s.selectionRange, children: [] };
        if (stack.length) stack[stack.length - 1].node.children.push(node);
        else tree.push(node);
        stack.push({ indent: indentOf(text, s.line), node });
      }
      reply(msg.id, tree);
      return;
    }
    case 'textDocument/formatting': {
      const uri = msg.params.textDocument.uri;
      const text = state.documents.get(uri);
      if (!text) return reply(msg.id, null);
      const formatted = formatFeature(text).join('\n') + (text.endsWith('\n') ? '\n' : '');
      if (formatted === text) return reply(msg.id, []);
      const lineCount = text.split(/\r?\n/).length;
      reply(msg.id, [{ range: { start: { line: 0, character: 0 }, end: { line: lineCount, character: 0 } }, newText: formatted }]);
      return;
    }
    default: {
      if (msg.id !== undefined) reply(msg.id, null);
    }
  }
}

function indentOf(text, line) {
  const l = text.split(/\r?\n/)[line] || '';
  const m = /^[ \t]*/.exec(l);
  return m ? m[0].length : 0;
}
function symKind(k) {
  return { namespace: 3, package: 4, object: 19 }[k] || 19;
}
