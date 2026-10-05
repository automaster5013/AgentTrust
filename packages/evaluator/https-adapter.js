import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { parseJson } from '../contracts/json.js';
import { validate } from '../contracts/index.js';

// Conservative IPv4-only egress. IPv6 and special-use destinations fail closed.
export function publicIPv4(address) {
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function resolveTarget(endpoint, resolver=lookup) {
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.search||url.hash||isIP(url.hostname)||!url.hostname.includes('.'))throw new Error('Invalid HTTPS target.');
  const records=await resolver(url.hostname,{all:true,verbatim:true});
  if(!records.length||records.some(r=>!publicIPv4(r.address)||r.family!==4))throw new Error('Non-public destination denied.');
  return {url,address:records[0].address};
}
export function validateEvidence(evidence) {
  // Reuse the bounded evidence contract, including nested input inspection.
  return validate('dataset',{name:'HTTPS evidence',cases:[{id:'response',input:'response',mock:evidence,rules:[{id:'required',type:'contains',value:'response'}]}]}).cases[0].mock;
}
export function buildHttpsRequest(snapshot,testCase){
  return validate('connectorRequest',{caseId:testCase.id,input:testCase.input,agentVersionId:snapshot.agent.id});
}
export async function httpsEvidence(snapshot,testCase,{organizationId,configuration=process.env.AGENTTRUST_HTTPS_TARGETS||'{}',resolver=lookup,transport=request}={}) {
  const targets=JSON.parse(configuration);
  const endpoint=targets[organizationId]?.[snapshot.agent.connectorId];
  if(typeof endpoint!=='string')throw new Error('Connector is disabled.');
  if(createHash('sha256').update(endpoint).digest('hex')!==snapshot.agent.endpointHash)throw new Error('Connector endpoint changed.');
  const payload=JSON.stringify(buildHttpsRequest(snapshot,testCase));
  const {url,address}=await resolveTarget(endpoint,resolver);
  return new Promise((resolve,reject)=>{
    let timer;
    const req=transport(url,{method:'POST',agent:false,rejectUnauthorized:true,servername:url.hostname,
      lookup:(_hostname,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4),
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'Accept':'application/json'}},res=>{
      const fail=()=>{res.destroy();req.destroy(new Error('Invalid HTTPS evidence response.'));};
      if(res.statusCode!==200||!/^application\/json(?:;|$)/i.test(res.headers['content-type']||'')||res.headers['content-encoding']){fail();return;}
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>65536)fail();else chunks.push(chunk);});
      res.on('error',reject);res.on('aborted',()=>reject(new Error('Incomplete HTTPS response.')));
      res.on('end',()=>{try{resolve(validateEvidence(parseJson(Buffer.concat(chunks))));}catch{reject(new Error('Invalid HTTPS evidence.'));}});
    });
    timer=setTimeout(()=>req.destroy(new Error('HTTPS adapter deadline exceeded.')),5000);
    req.on('error',error=>{clearTimeout(timer);reject(error);});req.on('close',()=>clearTimeout(timer));req.end(payload);
  });
}
