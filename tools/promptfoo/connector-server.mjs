import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {strictJson,profileHash,connectorGrader} from './connector-policy.mjs';

export function connectorServer(token,Ajv,reference){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('INVALID_CONNECTOR_CONFIGURATION');const grade=connectorGrader(Ajv);let busy=false;
 const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000},async(req,res)=>{
  const reply=(status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))}};
  if(req.url==='/grade'||req.url==='/health'){reference.emit('request',req,res);return}
  if(req.method!=='POST'||req.url!=='/recorded-grade')return reply(404,{error:'NOT_FOUND'});
  const supplied=req.headers['x-agenttrust-worker-token'];if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return reply(401,{error:'UNAUTHORIZED'});
  if(req.headers['content-type']!=='application/json')return reply(415,{error:'JSON_REQUIRED'});if(busy)return reply(503,{error:'VERIFIER_BUSY'});busy=true;
  try{const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)return reply(413,{error:'BODY_LIMIT'});chunks.push(chunk)}
   let body;try{body=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='sample,validatorProfileSha256')throw Error('INVALID_BODY')}catch{return reply(400,{error:'INVALID_SAMPLE'})}
   if(body.validatorProfileSha256!==profileHash())return reply(409,{error:'PROFILE_MISMATCH'});
   try{const started=performance.now(),result=grade(body.sample);if(performance.now()-started>=1000)return reply(503,{error:'VERIFIER_UNAVAILABLE'});return reply(200,result)}catch{return reply(400,{error:'INVALID_SAMPLE'})}
  }catch{return reply(503,{error:'VERIFIER_UNAVAILABLE'})}finally{busy=false}
 });server.keepAliveTimeout=1000;server.maxConnections=8;return server;
}
