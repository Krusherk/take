import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_MIGRATION_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../migrations");

const sql = postgres(databaseUrl, { max: 1 });

try {
  await sql`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const hasUsers = await sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'users'
    ) as exists
  `;

  if (hasUsers[0]?.exists) {
    await sql`
      insert into schema_migrations (id)
      values ('0000_initial.sql')
      on conflict do nothing
    `;
  }

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await sql`select 1 from schema_migrations where id = ${file}`;
    if (applied.length > 0) {
      continue;
    }

    const sqlText = await readFile(join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlText);
      await tx`insert into schema_migrations (id) values (${file})`;
    });
    console.log(`Applied ${file}`);
  }

  console.log("Database migrated");
} finally {
  await sql.end();
}
