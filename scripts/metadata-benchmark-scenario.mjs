const routes=[['identity','/v1/me'],['catalog','/v1/catalog'],['run-summaries','/v1/runs?limit=25'],['usage','/v1/usage']];
export function parseMetadataBenchmarkArgs(args){
  if(!args.length)return 20;
  if(args.length!==2||args[0]!=='--samples'||!/^[1-9][0-9]{0,2}$/.test(args[1])||String(Number(args[1]))!==args[1]||Number(args[1])>100)throw new Error('Use --samples 1..100 once.');
  return Number(args[1]);
}
export function summarizeDurations(values){
  if(!Array.isArray(values)||!values.length||values.some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid metadata timing samples.');
  const sorted=[...values].sort((a,b)=>a-b),round=v=>Math.round(v*1000)/1000;
  const percentile=p=>round(sorted[Math.ceil(sorted.length*p)-1]);
  return {samples:values.length,minMs:round(sorted[0]),p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:round(sorted.at(-1))};
}
export async function runMetadataBenchmark({call,samples=20,now=()=>performance.now()}){
  if(!Number.isInteger(samples)||samples<1||samples>100)throw new Error('Invalid metadata sample count.');
  const results=[];let requests=0;
  for(const [name,path] of routes){
    for(let i=0;i<2;i++){await call(path);requests++;}
    const durations=[];
    for(let i=0;i<samples;i++){const started=now();await call(path);durations.push(now()-started);requests++;}
    results.push({name,path,...summarizeDurations(durations)});
  }
  return {schemaVersion:1,completed:true,readOnlyMetadata:true,serverDeployed:false,samplesPerEndpoint:samples,warmupPerEndpoint:2,requests,results};
}
