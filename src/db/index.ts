import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function openDb(dataDir: string): { db: Db; sqlite: Database.Database } {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'crackedbot.db');
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/db -> ../../drizzle ; src/db -> ../../drizzle
  migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') });
  return { db, sqlite };
}

export { schema };
