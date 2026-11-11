// Lists every user-facing string in src/copy.ts as Markdown, for the owner to rewrite.
// Usage: node scripts/copy-list.mjs > COPY.md
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/copy.ts', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export const COPY'));
const out = ['# Dashboard copy', '', 'Every string a visitor can see. Edit them in `dashboard/web/src/copy.ts`.', ''];
let prefix = [];
for (const line of body.split('\n')) {
  const t = line.trim();
  if (t.startsWith('//')) { out.push('', `## ${t.replace(/^\/\/\s*/, '')}`, ''); continue; }
  const open = t.match(/^(\w+): [{[]$/);
  if (open) { prefix.push(open[1]); continue; }
  if (/^[}\]],?$/.test(t)) { prefix.pop(); continue; }
  const kv = t.match(/^(\w+): (['"])(.*)\2,?$/);
  if (kv) { out.push(`- \`${[...prefix, kv[1]].join('.')}\`: ${kv[3]}`); continue; }
  const inline = t.match(/^(\w+): \{(.*)\},?$/);
  if (inline) { for (const m of inline[2].matchAll(/(\w+): '([^']*)'/g)) out.push(`- \`${inline[1]}.${m[1]}\`: ${m[2]}`); continue; }
  const item = t.match(/^(['"])(.*)\1,?$/);
  if (item) out.push(`- \`${prefix.join('.')}[]\`: ${item[2]}`);
}
console.log(out.join('\n'));
