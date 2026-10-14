import {allowedPublicHost,type OidcEndpoints} from './oidc-endpoints.ts';
export const backchannelPath='/logout/connect/back-channel/keycloak';
export function isBackchannelSegments(segments:string[]):boolean{return segments.length===4&&segments.every((part,index)=>part===['logout','connect','back-channel','keycloak'][index])}
export function backchannelHostAllowed(host:string|null,endpoints:OidcEndpoints):boolean{return allowedPublicHost(host,endpoints)||endpoints.profile==='local-review'&&host==='stack-console:3000'}
/** Syntax only: signed logout authenticity is checked by the Core OIDC handler. */
export function backchannelForm(body:string,contentType:string|null):string{
 if(typeof body!=='string'||!body||new TextEncoder().encode(body).length>16384||typeof contentType!=='string'||contentType.length>100||!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(contentType))throw Error('LOGOUT_FORM_REFUSED');
 if(body.includes('&')||body.startsWith('?'))throw Error('LOGOUT_FORM_REFUSED');
 const entries=[...new URLSearchParams(body).entries()];if(entries.length!==1||entries[0][0]!=='logout_token'||!/^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,12288}\.[A-Za-z0-9_-]{1,2048}$/.test(entries[0][1]))throw Error('LOGOUT_FORM_REFUSED');
 return new URLSearchParams({logout_token:entries[0][1]}).toString();
}
export function backchannelResponse(status:number,retryAfter:string|null):Response{
 const safe=[200,204,400,401,429,503].includes(status)?status:502,headers=new Headers({'Cache-Control':'no-store'});
 if(safe===429&&retryAfter&&/^[1-9][0-9]{0,3}$/.test(retryAfter))headers.set('Retry-After',retryAfter);
 return safe===204?new Response(null,{status:204,headers}):Response.json({code:safe===200?'LOGOUT_PROCESSED':'LOGOUT_REFUSED'},{status:safe,headers});
}
