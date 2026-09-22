import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../database/migrations/", import.meta.url);
const files = readdirSync(dir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
if (!files.length) throw new Error("No migration files found.");
const versions = files.map((name) => Number(name.split("_")[0]));
for (let i = 0; i < versions.length; i += 1) {
  if (versions[i] !== i + 1) throw new Error(`Migration numbering gap at ${files[i]}.`);
}
for (const file of files) {
  const sql = readFileSync(join(dir.pathname, file), "utf8");
  if (/\b(DROP\s+TABLE|DROP\s+COLUMN)\b/i.test(sql) && !/--\s*ALLOW_DESTRUCTIVE_MIGRATION/i.test(sql)) {
    throw new Error(`Destructive migration requires an explicit marker: ${file}`);
  }
  if (!sql.trim()) throw new Error(`Empty migration: ${file}`);
}
console.log(`Validated ${files.length} migration(s).`);
