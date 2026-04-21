// Dev-only audit script - delete after use.
// Parses a JSX file's imports + destructures + params + local declarations,
// then diffs against all identifier-looking references in the body.
// Flags likely missing imports/props/destructures.

const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('usage: node tmp_audit.js <file>'); process.exit(1); }
const src = fs.readFileSync(path, 'utf8');

// Strip block + line comments and string/template literals — these contain
// prose words that would false-positive as unresolved identifiers.
function strip(s){
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/\/\/[^\n]*/g, '')                 // line comments
    .replace(/`(?:\.|\$\{[^}]*\}|[^`\])*`/g, '``')  // template literals
    .replace(/'(?:\.|[^'\])*'/g, "''")        // single-quoted strings
    .replace(/"(?:\.|[^"\])*"/g, '""');       // double-quoted strings
}
const clean = strip(src);

// Collect declared names
const known = new Set();
// Import names: import { a, b as c, d } from '...'
for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) known.add(name);
  }
}
// Default imports: import Foo from '...'
for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) { known.add(m[1]); }
// Namespace: import * as Foo from
for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from/g)) { known.add(m[1]); }
// const/let/var destructures: const { a, b: c } = ...
for (const m of clean.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
  for (const part of m[1].split(',')) {
    const tok = part.trim();
    if (!tok) continue;
    // handle `a`, `a: b`, `a = default`, `a: b = default`
    let name = tok.split(':').pop().trim().split('=')[0].trim();
    if (name) known.add(name);
  }
}
// array destructures: const [a, b] = ...
for (const m of clean.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split('=')[0].trim();
    if (name && /^\w+$/.test(name)) known.add(name);
  }
}
// plain consts: const foo = ...
for (const m of clean.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)) { known.add(m[1]); }
// function foo(args)
for (const m of clean.matchAll(/\bfunction\s+(\w+)\s*\(/g)) { known.add(m[1]); }
// function params: capture (a, b, {c, d}, [e, f]) style
for (const m of clean.matchAll(/\bfunction\s*\w*\s*\(([^)]*)\)/g)) {
  const params = m[1];
  for (const part of params.split(',')) {
    const p = part.trim();
    if (/^\w+$/.test(p)) known.add(p);
  }
  // destructures inside params
  for (const sub of params.matchAll(/\{([^}]+)\}/g)) {
    for (const x of sub[1].split(',')) {
      const n = x.trim().split(':').pop().trim().split('=')[0].trim();
      if (n) known.add(n);
    }
  }
}
// arrow function params: (a, b) => ...  or x => ...
for (const m of clean.matchAll(/\(([^)]*)\)\s*=>/g)) {
  for (const part of m[1].split(',')) {
    const p = part.trim().split(':').pop().trim().split('=')[0].trim();
    if (/^\w+$/.test(p)) known.add(p);
  }
  for (const sub of m[1].matchAll(/\{([^}]+)\}/g)) {
    for (const x of sub[1].split(',')) {
      const n = x.trim().split(':').pop().trim().split('=')[0].trim();
      if (n) known.add(n);
    }
  }
}
for (const m of clean.matchAll(/\b(\w+)\s*=>/g)) { known.add(m[1]); }

// Built-ins + React primitives everyone uses
const builtins = new Set([
  'Array','Object','String','Number','Boolean','Math','Date','JSON','Promise','Map','Set','WeakMap','WeakSet','RegExp','Error','Symbol',
  'null','true','false','undefined','NaN','Infinity','void','typeof','instanceof','new','this','super','return','if','else','for','while','do','switch','case','default','break','continue','throw','try','catch','finally','async','await','of','in','function','var','let','const','class','extends','import','export','from','as','delete','yield','globalThis',
  'React','document','window','localStorage','sessionStorage','navigator','console','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','parseInt','parseFloat','isNaN','isFinite','alert','confirm','prompt','URL','URLSearchParams','Blob','File','FileReader','fetch','performance','atob','btoa','encodeURIComponent','decodeURIComponent',
]);

// Collect identifier-looking references in the body
const refs = new Set();
// Match bare identifiers not preceded by ., ?., or :, and not starting with a digit
// JSX tags: <Foo ...> or <foo ...> — Foo is a React component ref
for (const m of clean.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
  const name = m[1];
  if (builtins.has(name) || known.has(name)) continue;
  if (/^\d/.test(name)) continue;
  // skip property access: .foo, ?.foo, obj.foo
  const prev = clean[m.index - 1];
  if (prev === '.') continue;
  // skip keys in object literals: { foo: x } — crude heuristic
  const next = clean[m.index + name.length];
  // keep `foo` in `foo: x` only if it's NOT a property-key in an obj literal
  // (hard to distinguish from labeled statements — accept some FP)
  refs.add(name);
}

// Report
const unresolved = [...refs].sort();
console.log(`Declared: ${known.size}`);
console.log(`Unresolved refs (${unresolved.length}):`);
for (const name of unresolved) console.log('  ' + name);
