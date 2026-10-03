import { pool } from '../api/database.js';
import { WorkerEngine } from './engine.js';
const database=pool(process.env.WORKER_DATABASE_URL);
const engine=new WorkerEngine(database);
process.on('SIGINT',()=>engine.stop()); process.on('SIGTERM',()=>engine.stop());
console.log('AgentTrust durable mock worker started.');
await engine.loop(); await database.end();
