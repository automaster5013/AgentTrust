import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';
import { transaction } from '../api/database.js';
import { audit } from '../api/auth.js';
import { finalizeClaim } from './finalize.js';
import { trustworthyOutcome } from './outcome.js';
import { finalize, incomplete } from '../api/pg-store.js';

export class WorkerEngine {
  constructor(database,{leaseMs=5000,pollMs=100}={}) { this.database=database; this.leaseMs=leaseMs; this.pollMs=pollMs; this.stopped=false; this.thread=null; }
  async sweep() {
    return transaction(this.database,async client => {
      const rows=(await client.query(`SELECT *,deadline<=clock_timestamp() AS expired FROM agenttrust.runs WHERE state IN ('queued','running') AND
        (deadline<=clock_timestamp() OR (state='running' AND lease_until<=clock_timestamp() AND attempts>=max_attempts))
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50`)).rows;
      for(const row of rows) {
        const expired=row.expired;
        await finalize(client,row,incomplete(expired?'timed_out':'failed',expired?'Evaluation exceeded its time budget.':'Worker retry limit was exhausted.'));
      }
      return rows.length;
    });
  }
  async claim() {
    return transaction(this.database,async client => {
      const result=await client.query(`SELECT * FROM agenttrust.runs WHERE deadline>clock_timestamp() AND attempts<max_attempts AND
        (state='queued' OR (state='running' AND lease_until<=clock_timestamp())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if(!result.rowCount) return null;
      const row=result.rows[0]; const lease=randomUUID();
      const claimed=(await client.query(`UPDATE agenttrust.runs SET state='running',attempts=attempts+1,lease_token=$2,
        lease_until=clock_timestamp()+$3*interval '1 millisecond',started_at=coalesce(started_at,clock_timestamp()) WHERE id=$1 RETURNING *`,[row.id,lease,this.leaseMs])).rows[0];
      await audit(client,{organizationId:row.organization_id},'run.claimed',row.id,{attempt:claimed.attempts});
      return claimed;
    });
  }
  async complete(row,outcome) {
    if(!outcome) return false;
    return transaction(this.database,async client => {
      const result=await client.query(`SELECT * FROM agenttrust.runs
        WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[row.id,row.lease_token]);
      if(!result.rowCount) return false;
      const current=result.rows[0];
      const checked=trustworthyOutcome(current,outcome)?outcome:incomplete('failed','Evaluation worker returned inconsistent evidence.');
      // The actual write uses one current DB timestamp for lease, deadline and completion.
      return finalizeClaim(client,current,checked);
    });
  }
  async execute(row) {
    if(row.snapshot.dataset.cases.length>row.case_budget) return this.complete(row,incomplete('failed','Evaluation exceeded its case budget.'));
    let timer, busy=false, settled=false, settle;
    const completion=new Promise(resolve=>{settle=outcome=>{if(!settled){settled=true;resolve(outcome);}};});
    const thread=new Worker(new URL('./evaluate-thread.js',import.meta.url),{workerData:{snapshot:row.snapshot,organizationId:row.organization_id},resourceLimits:{maxOldGenerationSizeMb:96,stackSizeMb:4}});
    this.thread=thread;
    thread.once('message',outcome=>settle(outcome));
    thread.once('error',()=>settle(incomplete('failed','Evaluation worker failed.')));
    thread.once('exit',()=>settle(null));
    timer=setInterval(async()=>{
      if(busy||settled) return; busy=true;
      try {
        const result=await this.database.query(`UPDATE agenttrust.runs SET lease_until=clock_timestamp()+$3*interval '1 millisecond'
          WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>clock_timestamp() AND deadline>clock_timestamp() RETURNING id`,[row.id,row.lease_token,this.leaseMs]);
        if(!result.rowCount||this.stopped) { settle(null); await thread.terminate(); }
      } catch { settle(null); await thread.terminate(); }
      finally {busy=false;}
    },Math.max(25,Math.min(250,this.leaseMs/3)));
    try { const outcome=await completion; return await this.complete(row,outcome); }
    finally {clearInterval(timer); await thread.terminate(); this.thread=null;}
  }
  async tick() { await this.sweep(); const row=await this.claim(); if(!row) return false; await this.execute(row); await this.sweep(); return true; }
  async loop() {
    while(!this.stopped) {
      try {if(!await this.tick()) await setTimeout(this.pollMs);}
      catch(error) {console.error(`Worker tick failed (${error.code || 'runtime'}). Retrying.`); await setTimeout(500);}
    }
  }
  async stop() { this.stopped=true; if(this.thread) await this.thread.terminate(); }
}
