const routes=[['identity','/v1/me'],['catalog','/v1/catalog'],['run-summaries','/v1/runs?limit=25'],['usage','/v1/usage']];
export function parseMetadataBenchmarkArgs(args){
  const options={samples:20,concurrency:1,organizationIndex:0},seen=new Set();
  for(let i=0;i<args.length;i+=2){
    const flag=args[i],value=args[i+1],name=flag==='--samples'?'samples':flag==='--concurrency'?'concurrency':flag==='--organization-index'?'organizationIndex':null;
    if(!name||seen.has(name)||typeof value!=='string'||!(name==='organizationIndex'?/^(0|[1-9][0-9]?)$/:/^[1-9][0-9]{0,2}$/).test(value)||String(Number(value))!==value||Number(value)>(name==='samples'?100:name==='concurrency'?8:99))throw new Error('Use --samples 1..100, --concurrency 1..8 and --organization-index 0..99 once each.');
    seen.add(name);options[name]=Number(value);
  }
  return options;
}
export function summarizeDurations(values){
  if(!Array.isArray(values)||!values.length||values.some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid metadata timing samples.');
  const sorted=[...values].sort((a,b)=>a-b),round=v=>Math.round(v*1000)/1000;
  const percentile=p=>round(sorted[Math.ceil(sorted.length*p)-1]);
  return {samples:values.length,minMs:round(sorted[0]),p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:round(sorted.at(-1))};
}
export async function runMetadataBenchmark({call,samples=20,concurrency=1,now=()=>performance.now()}){
  if(!Number.isInteger(samples)||samples<1||samples>100)throw new Error('Invalid metadata sample count.');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Invalid metadata concurrency.');
  const results=[];let requests=0,inFlight=0,maximumInFlightRequests=0;
  for(const [name,path] of routes){
    for(let i=0;i<2;i++){await call(path);requests++;}
    const durations=[];
    for(let i=0;i<samples;i+=concurrency){
      const settled=await Promise.allSettled(Array.from({length:Math.min(concurrency,samples-i)},async()=>{
        inFlight++;maximumInFlightRequests=Math.max(maximumInFlightRequests,inFlight);
        try{const started=now();await call(path);durations.push(now()-started);requests++;}finally{inFlight--;}
      }));
      const failed=settled.find(result=>result.status==='rejected');
      if(failed)throw failed.reason;
    }
    results.push({name,path,...summarizeDurations(durations)});
  }
  return {schemaVersion:1,completed:true,readOnlyMetadata:true,serverDeployed:false,oneViewerSession:true,concurrency,maximumInFlightRequests,timingMode:concurrency===1?'sequential':'bounded-parallel-waves',samplesPerEndpoint:samples,warmupPerEndpoint:2,requests,results};
}
