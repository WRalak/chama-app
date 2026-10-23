// CI dependency gate: fails on any high or critical npm advisory that is not in
// security/audit-allowlist.json, or whose allowlist entry has expired.
// Usage: npm audit --json > audit.json; node scripts/audit-gate.mjs audit.json
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'audit.json', 'utf8'));
const allow = JSON.parse(readFileSync(new URL('../security/audit-allowlist.json', import.meta.url), 'utf8')).advisories;
const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(allow.map((a) => [a.id, a]));
const problems = [];

for (const a of allow) {
  if (!a.reason || !a.owner || !/^\d{4}-\d{2}-\d{2}$/.test(a.expires ?? '')) problems.push(`allowlist entry ${a.id} needs reason, owner and expires`);
  else if (a.expires < today) problems.push(`allowlist entry ${a.id} (${a.package}) expired on ${a.expires}: fix it or re-review`);
}

const seen = new Set();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object') continue;
    const id = String(via.url ?? '').split('/').pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = allowed.get(id);
    const serious = via.severity === 'high' || via.severity === 'critical';
    if (entry) console.log(`accepted until ${entry.expires}: ${id} ${via.name} (${via.severity}) - ${entry.owner}`);
    else if (serious) problems.push(`${via.severity}: ${id} ${via.name} - ${via.title}`);
    else console.log(`note (${via.severity}, not gating): ${id} ${via.name} - ${via.title}`);
  }
}

if (problems.length) {
  console.error(`\nDependency gate failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nDependency gate passed.');
