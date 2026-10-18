// Checks the message catalogs and keeps new UI source free of hard-coded Chinese.
//   node scripts/check-catalog.mjs            check
//   node scripts/check-catalog.mjs --update   rewrite scripts/catalog-allowlist.txt with the current hits
// Allowlist lines look like `path/to/file.tsx :: <trimmed code line>`; they are
// known leftovers that the owning screen should move into the catalogs.
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const messages = join(root, "src/i18n/messages");
const allowFile = join(root, "scripts/catalog-allowlist.txt");
const scanned = ["src/reader", "src/screens", "src/app", "src/ui"];
const han = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const problems = [];

function keys(file) {
  const text = readFileSync(join(messages, file), "utf8");
  const found = new Map();
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)+)"\s*:/gm)) {
    found.set(m[1], (found.get(m[1]) ?? 0) + 1);
  }
  return found;
}

const en = keys("en.ts");
const zh = keys("zh.ts");
for (const [k, n] of en) if (n > 1) problems.push(`en.ts: duplicate key ${k}`);
for (const [k, n] of zh) if (n > 1) problems.push(`zh.ts: duplicate key ${k}`);
for (const k of en.keys()) {
  if (!zh.has(k)) problems.push(`zh.ts is missing key ${k}`);
}
for (const k of zh.keys()) {
  if (!en.has(k)) problems.push(`en.ts is missing key ${k}`);
}

function prevToken(out) {
  const t = out.trimEnd();
  return t ? t[t.length - 1] : "(";
}

// Blank out comments, keeping strings, template text and line structure.
function stripComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += d ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === "/" && /[(,=:[!&|?{};]/.test(prevToken(out))) {
      // a regular expression literal: copy it through, its quotes are not strings
      let inClass = false;
      out += c;
      i++;
      while (i < src.length && src[i] !== "\n") {
        const r = src[i];
        out += r;
        i++;
        if (r === "\\") {
          out += src[i] ?? "";
          i++;
        } else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
      }
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const hits = [];
for (const dir of scanned) {
  for (const file of files(join(root, dir))) {
    const rel = relative(root, file);
    const text = readFileSync(file, "utf8");
    const stripped = rel.endsWith(".css")
      ? text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
      : stripComments(text);
    stripped.split("\n").forEach((line, n) => {
      if (han.test(line)) {
        hits.push({ rel, line: n + 1, entry: `${rel} :: ${line.trim()}` });
      }
    });
  }
}

if (process.argv.includes("--update")) {
  const lines = [...new Set(hits.map((h) => h.entry))].sort();
  writeFileSync(allowFile, lines.join("\n") + (lines.length ? "\n" : ""));
  console.log(`catalog-allowlist.txt: ${lines.length} entries`);
  process.exit(0);
}

const allowed = new Set(
  existsSync(allowFile)
    ? readFileSync(allowFile, "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
    : [],
);
const used = new Set();
for (const h of hits) {
  if (allowed.has(h.entry)) used.add(h.entry);
  else {
    problems.push(
      `${h.rel}:${h.line} hard-coded Chinese; use the message catalogs: ${h.entry.split(" :: ").slice(1).join(" :: ")}`,
    );
  }
}
for (const e of allowed) {
  if (!used.has(e)) problems.push(`stale allowlist entry (remove it): ${e}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `catalog ok: ${en.size} keys, ${used.size} allowlisted hard-coded lines`,
);
