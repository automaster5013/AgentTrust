import { randomBytes, randomUUID } from 'node:crypto';
import { InputError } from '../../packages/contracts/index.js';
import { tokenHash } from '../../packages/contracts/hash.js';
import { transaction } from './database.js';

export const SESSION_COOKIE = 'agenttrust_session';
export function cookieToken(req) {
  const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`));
  const token = value?.slice(SESSION_COOKIE.length+1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export const sessionCookie = (token, expired = false) => `${SESSION_COOKIE}=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired ? 0 : 28800}`;
const sessionProof=Symbol('authenticated-session-proof');
export async function revalidateSession(client,context,{adminOnly=false,write=false}={}){
  if(!context?.[sessionProof])throw new InputError('Authentication required.',401);
  const row=(await client.query('SELECT * FROM agenttrust.authenticate_session($1)',[context[sessionProof]])).rows[0];
  if(!row||row.id!==context.membershipId||row.organization_id!==context.organizationId)throw new InputError('Session expired or revoked.',401);
  if(adminOnly||write)requireWrite({...context,role:row.role},adminOnly);
}
export async function audit(client, context, action, resourceId, detail = {}) {
  await client.query('INSERT INTO agenttrust.audit_events(id,organization_id,actor_id,action,resource_id,detail) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(),context.organizationId,context.membershipId || null,action,resourceId || null,detail]);
}
export function requireWrite(context, adminOnly = false) {
  if (!context || (adminOnly ? context.role !== 'admin' : !['admin','editor'].includes(context.role))) throw new InputError('Insufficient role.',403);
}
export class Auth {
  constructor(database) { this.database = database; this.failures = []; }
  async login(token) {
    const now = Date.now(); this.failures = this.failures.filter(t => t > now-60000);
    if (this.failures.length >= 20) throw new InputError('Too many login attempts. Try again in one minute.',429);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { this.failures.push(now); throw new InputError('Invalid access key.',401); }
    return transaction(this.database, async client => {
      const result = await client.query('SELECT * FROM agenttrust.lookup_credential($1)',[tokenHash(token)]);
      if (!result.rowCount) { this.failures.push(now); throw new InputError('Invalid access key.',401); }
      const row = result.rows[0]; const session = randomBytes(32).toString('hex');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[row.credential_id]);
      const valid=(await client.query('SELECT * FROM agenttrust.lookup_credential($1)',[tokenHash(token)])).rows[0];
      if(!valid||valid.organization_id!==row.organization_id)throw new InputError('Access key expired or revoked.',401);
      await client.query("SELECT set_config('app.organization_id',$1,true)",[row.organization_id]);
      await client.query('DELETE FROM agenttrust.sessions WHERE expires_at <= now()');
      const active = await client.query('SELECT count(*) FROM agenttrust.sessions WHERE credential_id=$1',[row.credential_id]);
      if (Number(active.rows[0].count) >= 20) throw new InputError('Too many active sessions. Sign out of an existing session.',429);
      await client.query("INSERT INTO agenttrust.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[tokenHash(session),row.credential_id]);
      await audit(client,{ organizationId:row.organization_id,membershipId:row.membership_id },'auth.login',row.credential_id);
      return { token:session };
    });
  }
  async authenticate(token) {
    if (!token) throw new InputError('Authentication required.',401);
    const result = await this.database.query('SELECT * FROM agenttrust.authenticate_session($1)',[tokenHash(token)]);
    if (!result.rowCount) throw new InputError('Session expired or revoked.',401);
    const row = result.rows[0];
    const projects = await transaction(this.database, async client => (await client.query('SELECT id,name FROM agenttrust.projects WHERE organization_id=$1 ORDER BY created_at,id',[row.organization_id])).rows,row.organization_id);
    if (!projects.length) throw new InputError('No accessible project.',403);
    return { membershipId:row.id, organizationId:row.organization_id, organizationName:row.organization_name, name:row.name, role:row.role, projectId:projects[0].id, projects,[sessionProof]:tokenHash(token) };
  }
  async logout(token, context) {
    if (!token) return;
    await transaction(this.database, async client => {
      await client.query('DELETE FROM agenttrust.sessions WHERE token_hash=$1',[tokenHash(token)]);
      if (context) await audit(client,context,'auth.logout',context.membershipId);
    },context?.organizationId);
  }
}
