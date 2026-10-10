import {NextRequest} from 'next/server';
import {proxyPath,sameOrigin,sessionCookies} from '../../../lib/proxy-policy';
export const dynamic='force-dynamic';
async function forward(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 try{
  const path=proxyPath((await context.params).path,request.method);
  const publicHost=request.headers.get('host');
  if(!['127.0.0.1:4320','localhost:4320'].includes(publicHost??'')||request.nextUrl.search||request.method==='POST'&&!sameOrigin(request.headers.get('origin'),'http://'+publicHost))return Response.json({code:'ORIGIN_REFUSED'},{status:403});
  const base=new URL(process.env.CORE_API_URL??'http://127.0.0.1:4321');
  if(!['http://stack-core-api:8080','http://127.0.0.1:4321'].includes(base.origin)||base.pathname!=='/')throw Error('INVALID_API_CONFIGURATION');
  const headers=new Headers({'Accept':'application/json'});const cookie=sessionCookies(request.headers.get('cookie'));if(cookie)headers.set('Cookie',cookie);
  let body:string|undefined;
  if(request.method==='POST'){
   const reader=request.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
   if(reader)for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>16384){await reader.cancel();return Response.json({code:'INVALID_REQUEST'},{status:413})}chunks.push(next.value)}
   const merged=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.length}body=new TextDecoder('utf-8',{fatal:true}).decode(merged);
   headers.set('Content-Type',path==='/api/login'?'application/x-www-form-urlencoded':'application/json');
   for(const name of ['X-CSRF-TOKEN','Idempotency-Key']){const value=request.headers.get(name);if(value&&value.length<=2048)headers.set(name,value)}
  }
  const upstream=await fetch(new URL(path,base),{method:request.method,headers,body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  const data=await upstream.text();if(data.length>1048576)throw Error('RESPONSE_LIMIT');
  const output=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  for(const cookie of upstream.headers.getSetCookie())if(cookie.startsWith('AGENTTRUST_STACK_SESSION='))output.append('Set-Cookie',cookie);
  return new Response(data,{status:upstream.status,headers:output});
 }catch{return Response.json({code:'REQUEST_UNAVAILABLE'},{status:502})}
}
export const GET=forward;export const POST=forward;
