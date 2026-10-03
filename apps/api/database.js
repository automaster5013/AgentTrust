import pg from 'pg';
export function pool(connectionString) {
  if (!connectionString) throw new Error('Database configuration is required. Run npm run setup.');
  const value = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  value.on('error', error => console.error(`Database connection error (${error.code || 'unknown'}).`));
  return value;
}
export async function transaction(pool, fn, organizationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (organizationId) await client.query("SELECT set_config('app.organization_id',$1,true)", [organizationId]);
    const result = await fn(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
