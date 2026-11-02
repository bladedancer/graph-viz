// Extracts the root-level resource types from the Fusion graph model into server/root-resources.json.
// Usage: npm run roots -- <path to .../io/dxchange/graph/model>
// An @Include with no rootLevel argument is root level (the annotation's default is true).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Root types left out on purpose. `envmode` can't be read: the tenant answers every request for it with a 500
// (Jackson "Document nesting depth exceeds the maximum").
const EXCLUDED = new Set(['envmode']);

const dir = process.argv[2];
if (!dir) {
    console.error('Usage: npm run roots -- <graph model dir>');
    process.exit(1);
}

const walk = (d) =>
    readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.java') ? [p] : [];
    });

// Returns the text between the parens of the first @Include( ... ), honouring strings and nesting.
const includeArgs = (src) => {
    const start = src.search(/@Include\s*\(/);
    if (start < 0) return null;
    let i = src.indexOf('(', start) + 1;
    const begin = i;
    let depth = 1;
    let inStr = false;
    for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (inStr) {
            if (c === '\\') i++;
            else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '(') depth++;
        else if (c === ')') depth--;
    }
    return src.slice(begin, i - 1);
};

// Reads a named string argument: "a" + "b" literals, or a constant (Foo.NAME) declared in the same file.
const str = (args, key, src) => {
    const m = args.match(new RegExp(`\\b${key}\\s*=\\s*((?:"(?:[^"\\\\]|\\\\.)*"\\s*\\+?\\s*)+)`));
    if (m) return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('');
    const c = args.match(new RegExp(`\\b${key}\\s*=\\s*(?:\\w+\\.)?([A-Z_][A-Z0-9_]*)\\s*[,)]?`));
    if (!c) return undefined;
    const decl = src.match(new RegExp(`\\b${c[1]}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return decl ? decl[1] : undefined;
};

const roots = [];
const skipped = [];
for (const file of walk(dir).sort()) {
    const src = readFileSync(file, 'utf8');
    const args = includeArgs(src);
    if (args === null) continue;
    const rootLevel = args.match(/\brootLevel\s*=\s*(true|false)/);
    const entry = {
        name: str(args, 'name', src),
        friendlyName: str(args, 'friendlyName', src),
        description: str(args, 'description', src),
    };
    if (!entry.name) {
        skipped.push(file);
        continue;
    }
    if ((!rootLevel || rootLevel[1] === 'true') && !EXCLUDED.has(entry.name)) roots.push(entry);
}
if (skipped.length) console.error(`No name found in: ${skipped.join(', ')}`);
roots.sort((a, b) => a.friendlyName?.localeCompare(b.friendlyName ?? '') ?? 0);
const out = new URL('../server/root-resources.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(roots, null, 4)}\n`);
console.log(`${roots.length} root-level resources written to server/root-resources.json`);
