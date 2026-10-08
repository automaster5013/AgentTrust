import {pathToFileURL} from 'node:url';
import {pool} from '../api/database.js';
import {inspectServiceReadiness} from '../../packages/operations/readiness.js';

export async function workerReadiness(database) {
  return (await inspectServiceReadiness(database,'worker')).status==='ready';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let database;
  try{database=pool(process.env.WORKER_DATABASE_URL);if(!await workerReadiness(database))process.exitCode=1;}
  catch{process.exitCode=1;}
  finally{if(database)await database.end();}
}
