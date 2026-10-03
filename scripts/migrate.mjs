import { readdir, readFile } from 'node:fs/promises';
import { hash } from '../packages/contracts/hash.js';
import { transaction } from '../apps/api/database.js';
export async function migrate(database) {
  await transaction(database, async client => {
    await client.query('SELECT pg_advisory_xact_lock(4310001)');
    await client.query('CREATE TABLE IF NOT EXISTS public.agenttrust_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())');
    for (const name of (await readdir(new URL('../infra/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
      const sql = (await readFile(new URL(`../infra/migrations/${name}`, import.meta.url), 'utf8')).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
      const checksum = hash(sql.trimEnd());
      const acceptedChecksums = [checksum,hash(sql.trimEnd()+'\n'),hash(sql.trimEnd()+'\n\n')];
      const existing = await client.query('SELECT checksum FROM public.agenttrust_migrations WHERE name=$1', [name]);
      if (existing.rowCount) { if (!acceptedChecksums.includes(existing.rows[0].checksum)) throw new Error(`Migration changed: ${name}`); continue; }
      await client.query(sql); await client.query('INSERT INTO public.agenttrust_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
    }
  });
}
