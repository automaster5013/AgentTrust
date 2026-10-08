import assert from 'node:assert/strict';
import {validateLocalSetup} from './setup-target.mjs';

export function stagingOptions(args){
 const options={users:20,samples:5,concurrency:20,workers:2,durationMinutes:1,roundIntervalSeconds:60},seen=new Set();
 const flags=new Map([['--users',['users',2,20]],['--samples',['samples',1,20]],['--concurrency',['concurrency',1,20]],['--workers',['workers',1,4]],['--duration-minutes',['durationMinutes',1,240]],['--round-interval-seconds',['roundIntervalSeconds',30,300]]]);
 for(let i=0;i<args.length;i+=2){const rule=flags.get(args[i]),text=args[i+1];assert.ok(rule&&!seen.has(rule[0])&&typeof text==='string'&&/^[1-9][0-9]{0,2}$/.test(text));const value=Number(text);assert.ok(value>=rule[1]&&value<=rule[2]);seen.add(rule[0]);options[rule[0]]=value;}
 assert.equal(options.users%2,0);return options;
}
export function stagingTarget(env,name){
 validateLocalSetup(env);assert.match(name,/^agenttrust_stage_[a-f0-9]{32}$/);
 const replace=key=>{const url=new URL(env[key]);url.pathname='/'+name;return url.href;};
 return {name,ownerUrl:replace('OWNER_DATABASE_URL'),apiUrl:replace('DATABASE_URL'),workerUrl:replace('WORKER_DATABASE_URL')};
}
export function stagingDropStatement(name,createdName){
 assert.match(name,/^agenttrust_stage_[a-f0-9]{32}$/);assert.equal(name,createdName);
 return 'DROP DATABASE "'+name+'"';
}
