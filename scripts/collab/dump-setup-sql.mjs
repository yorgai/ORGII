// Regenerates scripts/collab/setup-v2.sql from the TS source of truth.
// Usage: node scripts/collab/dump-setup-sql.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const typesSource = readFileSync(
  join(root, "src/store/collaboration/types.ts"),
  "utf8"
);
const schemaVersion = typesSource.match(
  /SUPABASE_SYNC_SCHEMA_VERSION\s*=\s*(\d+)/
)?.[1];
const bucket = typesSource.match(
  /SUPABASE_SESSION_SNAPSHOT_BUCKET\s*=\s*"([^"]+)"/
)?.[1];
if (!schemaVersion || !bucket) throw new Error("constants not found in types.ts");

const sqlSource = readFileSync(
  join(root, "src/features/TeamCollaboration/sync/supabaseSetupSql.ts"),
  "utf8"
);
const literal = sqlSource.match(
  /ORGII_SUPABASE_SETUP_SQL = `([\s\S]*)`;\s*$/
)?.[1];
if (!literal) throw new Error("SQL template literal not found");

const sql = literal
  .replaceAll("${SUPABASE_SYNC_SCHEMA_VERSION}", schemaVersion)
  .replaceAll("${SUPABASE_SESSION_SNAPSHOT_BUCKET}", bucket);

const target = join(root, "scripts/collab/setup-v2.sql");
writeFileSync(target, `${sql}\n`);
console.log(
  `Wrote ${target} (schema v${schemaVersion}, bucket ${bucket}, ${sql.length} chars)`
);
