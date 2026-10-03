import { randomBytes, randomUUID } from 'node:crypto';
import { InputError } from '../../packages/contracts/index.js';
import { hash,tokenHash } from '../../packages/contracts/hash.js';
import { transaction } from './database.js';
import { pageResult } from './pagination.js';
export const sessionPageContext=context=>({...context,cursorScope:hash({resource:'sessions',role:context.role,membershipId:context.role==='admin'?null:context.membershipId})});

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
export async function audit(client, context, action, resourceId, detail = {},{eventTime=false}={}) {
  await client.query(`INSERT INTO agenttrust.audit_events(id,organization_id,actor_id,action,resource_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,${eventTime?'clock_timestamp()':'now()'})`, [randomUUID(),context.organizationId,context.membershipId || null,action,resourceId || null,detail]);
}
export function requireWrite(context, adminOnly = false) {
  if (!context || (adminOnly ? context.role !== 'admin' : !['admin','editor'].includes(context.role))) throw new InputError('Insufficient role.',403);
}
export class Auth {
  constructor(database,{successLoginLimitPerCredential=20,successLoginLimitPerOrganization=120}={}) {
    if(!Number.isInteger(successLoginLimitPerCredential)||successLoginLimitPerCredential<1||successLoginLimitPerCredential>20||!Number.isInteger(successLoginLimitPerOrganization)||successLoginLimitPerOrganization<1||successLoginLimitPerOrganization>120)throw new Error('Invalid successful-login limits.');
    this.database = database; this.failures = []; this.pendingLogins=0;
    this.successLoginLimitPerCredential=successLoginLimitPerCredential;this.successLoginLimitPerOrganization=successLoginLimitPerOrganization;
  }
  async login(token) {
    const now = Date.now(); this.failures = this.failures.filter(t => t > now-60000);
    if (this.failures.length+this.pendingLogins >= 20) throw new InputError('Too many login attempts. Try again in one minute.',429);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) { this.failures.push(now); throw new InputError('Invalid access key.',401); }
    this.pendingLogins++;
    try {return await transaction(this.database, async client => {
      const result = await client.query('SELECT * FROM agenttrust.lookup_credential($1)',[tokenHash(token)]);
      if (!result.rowCount) throw new InputError('Invalid access key.',401);
      const row = result.rows[0]; const session = randomBytes(32).toString('hex');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[row.credential_id]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))',[row.organization_id]);
      const valid=(await client.query('SELECT * FROM agenttrust.lookup_credential($1)',[tokenHash(token)])).rows[0];
      if(!valid||valid.organization_id!==row.organization_id||valid.credential_id!==row.credential_id||valid.membership_id!==row.membership_id)throw new InputError('Access key expired or revoked.',401);
      await client.query("SELECT set_config('app.organization_id',$1,true)",[row.organization_id]);
      const recent=(await client.query("SELECT count(*) AS organization_count,count(*) FILTER (WHERE resource_id=$1) AS credential_count FROM agenttrust.audit_events WHERE action='auth.login' AND created_at>clock_timestamp()-interval '60 seconds'",[row.credential_id])).rows[0];
      if(Number(recent.credential_count)>=this.successLoginLimitPerCredential||Number(recent.organization_count)>=this.successLoginLimitPerOrganization)throw new InputError('Too many successful logins. Try again in one minute.',429);
      await client.query('DELETE FROM agenttrust.sessions WHERE expires_at <= now()');
      const active = await client.query('SELECT count(*) FROM agenttrust.sessions WHERE credential_id=$1',[row.credential_id]);
      if (Number(active.rows[0].count) >= 20) throw new InputError('Too many active sessions. Sign out of an existing session.',429);
      await client.query("INSERT INTO agenttrust.sessions(token_hash,credential_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[tokenHash(session),row.credential_id]);
      await audit(client,{ organizationId:row.organization_id,membershipId:row.membership_id },'auth.login',row.credential_id,{}, {eventTime:true});
      return { token:session };
    });}catch(error){
      if(error instanceof InputError&&error.status===401)this.failures.push(Date.now());
      throw error;
    }finally{this.pendingLogins--;}
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
  async sessions(context,page={limit:25}) {
    return transaction(this.database,async client=>{
      await revalidateSession(client,context,{adminOnly:context.role==='admin'});
      const rows=(await client.query(`SELECT s.id,m.id AS "membershipId",m.name,m.role,s.created_at AS "createdAt",s.expires_at AS "expiresAt",
        s.token_hash=$3 AS current,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM agenttrust.sessions s JOIN agenttrust.credentials c ON c.id=s.credential_id JOIN agenttrust.memberships m ON m.id=c.membership_id
        WHERE m.organization_id=$1 AND ($2::uuid IS NULL OR m.id=$2) AND m.active AND c.revoked_at IS NULL AND s.expires_at>clock_timestamp()
        AND ($4::timestamptz IS NULL OR (s.created_at,s.id)<($4::timestamptz,$5::uuid))
        ORDER BY s.created_at DESC,s.id DESC LIMIT $6`,[context.organizationId,context.role==='admin'?null:context.membershipId,context[sessionProof],page.cursor?.time||null,page.cursor?.id||null,page.limit+1])).rows;
      return {...pageResult(rows,page,sessionPageContext(context)),scope:context.role==='admin'?'organization':'self'};
    },context.organizationId);
  }
  async revokeSession(context,id) {
    if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new InputError('Invalid session id.');
    return transaction(this.database,async client=>{
      const target=(await client.query(`SELECT s.id,s.token_hash=$3 AS current FROM agenttrust.sessions s
        JOIN agenttrust.credentials c ON c.id=s.credential_id JOIN agenttrust.memberships m ON m.id=c.membership_id
        WHERE s.id=$4 AND m.organization_id=$1 AND ($2::uuid IS NULL OR m.id=$2)`,[context.organizationId,context.role==='admin'?null:context.membershipId,context[sessionProof],id])).rows[0];
      await revalidateSession(client,context,{adminOnly:context.role==='admin'});
      if(!target)throw new InputError('Unknown session.',404);
      // DELETE supplies the row lock without granting UPDATE on session identity columns.
      const deleted=(await client.query('DELETE FROM agenttrust.sessions WHERE id=$1 RETURNING id,credential_id,expires_at,token_hash=$2 AS current',[id,context[sessionProof]])).rows[0];
      if(!deleted){await revalidateSession(client,context,{adminOnly:context.role==='admin'});throw new InputError('Unknown session.',404);}
      if(deleted.current){
        const valid=(await client.query(`SELECT c.id FROM agenttrust.credentials c JOIN agenttrust.memberships m ON m.id=c.membership_id
          WHERE c.id=$1 AND m.id=$2 AND m.organization_id=$3 AND c.revoked_at IS NULL AND m.active AND $4::timestamptz>clock_timestamp()`,[deleted.credential_id,context.membershipId,context.organizationId,deleted.expires_at])).rowCount;
        if(!valid)throw new InputError('Session expired or revoked.',401);
      }else await revalidateSession(client,context,{adminOnly:context.role==='admin'});
      await audit(client,context,'auth.session.revoked',id,{current:deleted.current});
      return {id,revoked:true,current:deleted.current};
    },context.organizationId);
  }
  async logout(token, context) {
    if (!token) return;
    await transaction(this.database, async client => {
      await client.query('DELETE FROM agenttrust.sessions WHERE token_hash=$1',[tokenHash(token)]);
      if (context) await audit(client,context,'auth.logout',context.membershipId);
    },context?.organizationId);
  }
}
