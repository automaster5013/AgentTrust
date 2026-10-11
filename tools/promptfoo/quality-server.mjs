import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {gradeRaw,profileHash} from './quality-policy.mjs';

export function verifierServer(token,grader=gradeRaw){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid verifier configuration');
 const fingerprint=profileHash();let busy=false;
 const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(req,res)=>{
  const reply=(status,value)=>{if(res.writableEnded||res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
  if(req.method==='GET'&&req.url==='/health')return reply(200,{status:'ok'});
  if(req.method!=='POST'||req.url!=='/grade')return reply(404,{error:'NOT_FOUND'});
  const supplied=req.headers['x-agenttrust-worker-token'];
  if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return reply(401,{error:'UNAUTHORIZED'});
  if(req.headers['content-type']!=='application/json')return reply(415,{error:'JSON_REQUIRED'});
  if(busy)return reply(503,{error:'VERIFIER_BUSY'});
  busy=true;
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>8192)return reply(413,{error:'BODY_LIMIT'});chunks.push(chunk)}
   let body;
   try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{return reply(400,{error:'INVALID_SAMPLE'})}
   if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='actual,expected,validatorProfileSha256'||typeof body.actual!=='string'||Buffer.byteLength(body.actual)>2048||typeof body.expected!=='string'||!body.expected.trim()||Buffer.byteLength(body.expected)>128)return reply(400,{error:'INVALID_SAMPLE'});
   if(body.validatorProfileSha256!==fingerprint)return reply(409,{error:'PROFILE_MISMATCH'});
   let expired=false;
   const deadline=setTimeout(()=>{expired=true;reply(503,{error:'VERIFIER_UNAVAILABLE'})},15000);
   try{const grade=await grader(body.actual,body.expected);if(!expired)return reply(200,grade)}finally{clearTimeout(deadline)}
  }catch{return reply(503,{error:'VERIFIER_UNAVAILABLE'})}
  finally{busy=false}
 });
 server.keepAliveTimeout=1000;server.maxConnections=8;
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const token=readFileSync('/run/secrets/stack-worker-token','utf8');
 verifierServer(token).listen(9105,'0.0.0.0');
}
