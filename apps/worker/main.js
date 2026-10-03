import { pool } from '../api/database.js';
import { WorkerEngine } from './engine.js';
import { heartbeat } from './health.js';
import { validateDatabaseRole } from '../api/role-guard.js';
const database=pool(process.env.WORKER_DATABASE_URL);
const engine=new WorkerEngine(database);
await validateDatabaseRole(database,'worker');
await heartbeat(database);
let checking=false;
const timer=setInterval(async()=>{
  if(checking)return;checking=true;
  try{await validateDatabaseRole(database,'worker');await heartbeat(database);}catch{console.error('Worker database safety or heartbeat check failed.');await engine.stop();}finally{checking=false;}
},2000);
const stop=()=>{clearInterval(timer);return engine.stop();};
process.on('SIGINT',stop); process.on('SIGTERM',stop);
console.log('AgentTrust durable mock worker started.');
try{await engine.loop();}finally{clearInterval(timer);await database.end();}
