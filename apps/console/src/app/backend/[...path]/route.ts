import {configuredOidcEndpoints,allowedPublicHost,validateSessionCookie} from '../../../lib/oidc-endpoints';
import {NextRequest} from 'next/server';
import {boundedUtf8,BoundedTextError} from '../../../lib/bounded-utf8';
import {proxyPath,sameOrigin,sessionCookies,oauthQuery,oidcRedirect} from '../../../lib/proxy-policy';
export const dynamic='force-dynamic';
async function forward(request:NextRequest,context:{params:Promise<{path:string[]}>}){
 try{
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(10000)]);
  const path=proxyPath((await context.params).path,request.method);
  const endpoints=configuredOidcEndpoints();
  const query=oauthQuery(path,request.nextUrl.searchParams,endpoints);
  const publicHost=request.headers.get('host');
  if(!allowedPublicHost(publicHost,endpoints)||request.method==='POST'&&!sameOrigin(request.headers.get('origin'),endpoints.profile==='local-review'?'http://'+publicHost:endpoints.applicationOrigin))return Response.json({code:'ORIGIN_REFUSED'},{status:403});
  const base=new URL(process.env.CORE_API_URL??'http://127.0.0.1:4321');
  if(!['http://stack-core-api:8080','http://stack-gateway:8080','http://127.0.0.1:4321'].includes(base.origin)||base.pathname!=='/')throw Error('INVALID_API_CONFIGURATION');
  const headers=new Headers({'Accept':'application/json'});const cookie=sessionCookies(request.headers.get('cookie'));if(cookie)headers.set('Cookie',cookie);
  let body:string|undefined;
  if(request.method==='POST'){
   try{body=await boundedUtf8(request.body,16384,signal)}catch(error){if(error instanceof BoundedTextError)return Response.json({code:error.code==='BYTE_LIMIT'?'INVALID_REQUEST':'INVALID_JSON_TEXT'},{status:error.code==='BYTE_LIMIT'?413:400});throw error}
   headers.set('Content-Type',path==='/api/login'?'application/x-www-form-urlencoded':'application/json');
   for(const name of ['X-CSRF-TOKEN','Idempotency-Key']){const value=request.headers.get(name);if(value&&value.length<=2048)headers.set(name,value)}
  }
  const upstream=await fetch(new URL(path+query,base),{method:request.method,headers,body,cache:'no-store',redirect:'manual',signal});
  const data=await boundedUtf8(upstream.body,1048576,signal);
  const output=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  for(const cookie of upstream.headers.getSetCookie())if(cookie.startsWith('AGENTTRUST_STACK_SESSION=')){validateSessionCookie(cookie,endpoints);output.append('Set-Cookie',cookie)}
  if([302,303].includes(upstream.status)){output.set('Location',oidcRedirect(path,upstream.headers.get('location')??'',endpoints));return new Response(null,{status:upstream.status,headers:output})}
  return new Response(data,{status:upstream.status,headers:output});
 }catch{return Response.json({code:'REQUEST_UNAVAILABLE'},{status:502})}
}
export const GET=forward;export const POST=forward;
