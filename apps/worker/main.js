import { pool } from '../api/database.js';
import { WorkerEngine } from './engine.js';
import { heartbeat } from './health.js';
const database=pool(process.env.WORKER_DATABASE_URL);
const engine=new WorkerEngine(database);
await heartbeat(database);
let checking=false;
const timer=setInterval(async()=>{
  if(checking)return;checking=true;
  try{await heartbeat(database);}catch{console.error('Worker health heartbeat failed.');}finally{checking=false;}
},2000);
const stop=()=>{clearInterval(timer);return engine.stop();};
process.on('SIGINT',stop); process.on('SIGTERM',stop);
console.log('AgentTrust durable mock worker started.');
try{await engine.loop();}finally{clearInterval(timer);await database.end();}
