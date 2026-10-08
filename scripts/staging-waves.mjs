import assert from 'node:assert/strict';
export async function boundedStagingWaves(tasks,concurrency,onProgress=()=>{}){
 assert.ok(Array.isArray(tasks)&&tasks.length<=1600);assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=20);
 let completed=0,maximumInFlight=0,inFlight=0;
 for(let offset=0;offset<tasks.length;offset+=concurrency){
  const results=await Promise.allSettled(tasks.slice(offset,offset+concurrency).map(async task=>{inFlight++;maximumInFlight=Math.max(maximumInFlight,inFlight);try{await task();completed++;}finally{inFlight--;}}));
  onProgress({completed,maximumInFlight});const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
 }
 return {completed,maximumInFlight};
}
