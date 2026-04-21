// Dev-only audit script - delete after use.
// Parses a JSX file's imports + destructures + params + local declarations,
// then diffs against all identifier-looking references in the body.
// Flags likely missing imports/props/destructures.

const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('usage: node tmp_audit.cjs <file>'); process.exit(1); }
const src = fs.readFileSync(path, 'utf8');

// Strip block + line comments and string/template literals
function strip(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i], c2 = s[i+1];
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s[i] === '*' && s[i+1] === '/')) i++;
      i += 2;
      out += '  ';
    } else if (c === '/' && c2 === '/') {
      while (i < n && s[i] !== '\n') { i++; }
      out += ' ';
    } else if (c === '`') {
      out += '``';
      i++;
      while (i < n && s[i] !== '`') {
        if (s[i] === '\\' && i+1 < n) i += 2;
        else if (s[i] === '$' && s[i+1] === '{') {
          // keep ${...} since identifiers inside are real refs
          out += '${';
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (s[i] === '{') depth++;
            else if (s[i] === '}') depth--;
            if (depth > 0) out += s[i];
            i++;
          }
          out += '}';
        } else { i++; }
      }
      if (i < n) i++;
    } else if (c === "'" || c === '"') {
      const quote = c;
      out += quote + quote;
      i++;
      while (i < n && s[i] !== quote) {
        if (s[i] === '\\' && i+1 < n) i += 2;
        else i++;
      }
      if (i < n) i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
const clean = strip(src);

const known = new Set();
for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) known.add(name);
  }
}
for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) { known.add(m[1]); }
for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from/g)) { known.add(m[1]); }

// destructures
function addDestructure(inside) {
  // very rough: split on commas at depth 0
  let depth = 0, buf = '', parts = [];
  for (const ch of inside) {
    if ((ch === '{' || ch === '[' || ch === '(')) depth++;
    else if ((ch === '}' || ch === ']' || ch === ')')) depth--;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  for (const part of parts) {
    let name = part.trim();
    if (!name) continue;
    // rest
    if (name.startsWith('...')) name = name.slice(3).trim();
    // rename: a: b → b
    if (name.includes(':')) name = name.split(':').slice(1).join(':').trim();
    // default: a = x → a
    name = name.split('=')[0].trim();
    // array destructure inside? skip
    if (name.startsWith('{') || name.startsWith('[')) continue;
    if (/^\w+$/.test(name)) known.add(name);
  }
}
for (const m of clean.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) addDestructure(m[1]);
for (const m of clean.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=/g)) addDestructure(m[1]);
for (const m of clean.matchAll(/(?:const|let|var)\s+(\w+)\s*=/g)) { known.add(m[1]); }
for (const m of clean.matchAll(/\bfunction\s+(\w+)\s*\(/g)) { known.add(m[1]); }

// function/arrow params (crude, gets most)
for (const m of clean.matchAll(/\bfunction\s*\w*\s*\(([^)]*)\)/g)) addDestructure(m[1]);
for (const m of clean.matchAll(/\(([^)]*)\)\s*=>/g)) addDestructure(m[1]);
for (const m of clean.matchAll(/(^|[^\w.])(\w+)\s*=>/g)) { known.add(m[2]); }

// catch (e) / for (const x of ...)
for (const m of clean.matchAll(/\bcatch\s*\(\s*(\w+)\s*\)/g)) { known.add(m[1]); }
for (const m of clean.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+(\w+)\s+(?:of|in)\s/g)) { known.add(m[1]); }

const builtins = new Set([
  'Array','Object','String','Number','Boolean','Math','Date','JSON','Promise','Map','Set','WeakMap','WeakSet','RegExp','Error','Symbol',
  'null','true','false','undefined','NaN','Infinity','void','typeof','instanceof','new','this','super','return','if','else','for','while','do','switch','case','default','break','continue','throw','try','catch','finally','async','await','of','in','function','var','let','const','class','extends','import','export','from','as','delete','yield','globalThis',
  'React','document','window','localStorage','sessionStorage','navigator','console','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','parseInt','parseFloat','isNaN','isFinite','alert','confirm','prompt','URL','URLSearchParams','Blob','File','FileReader','fetch','performance','atob','btoa','encodeURIComponent','decodeURIComponent','XLSX','history','location'
]);

const refs = new Map();
const re = /[A-Za-z_$][\w$]*/g;
let m;
while ((m = re.exec(clean)) !== null) {
  const name = m[0];
  if (builtins.has(name) || known.has(name)) continue;
  if (/^\d/.test(name)) continue;
  const prev = clean[m.index - 1];
  if (prev === '.') continue;
  // check for : right after (object key or labeled stmt)
  const after = clean.slice(m.index + name.length).replace(/^\s+/, '');
  // crude JSX attr detection: `name=` in a JSX-looking context — still an identifier if PascalCase, but usually a prop key
  if (after.startsWith(':')) {
    // object key in an object literal. The value on the right might reference the same name (shorthand), but with `:` it's a renamed key.
    // Skip.
    continue;
  }
  if (after.startsWith('=') && !after.startsWith('==') && !after.startsWith('=>')) {
    // could be JSX prop (<Foo bar={x}>) — those props are keys, not refs. Skip.
    continue;
  }
  refs.set(name, (refs.get(name) || 0) + 1);
}

console.log(`Declared known: ${known.size}`);
console.log(`Unresolved refs: ${refs.size}`);
const sorted = [...refs.entries()].sort((a,b) => a[0].localeCompare(b[0]));
for (const [name, count] of sorted) console.log(`  ${name}  ×${count}`);
