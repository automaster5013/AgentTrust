export type OidcEndpoints={profile:'local-review'|'https-review';applicationOrigin:string;publicIssuer:string};
export function oidcEndpoints(profile='local-review',applicationOrigin='http://127.0.0.1:4320',publicIssuer='http://127.0.0.1:4322/realms/agenttrust'):OidcEndpoints {
  const invalid=()=>{throw Error('INVALID_OIDC_CONFIGURATION')};
  if(profile==='local-review'){
    if(applicationOrigin!=='http://127.0.0.1:4320'||publicIssuer!=='http://127.0.0.1:4322/realms/agenttrust')invalid();
  }else if(profile==='https-review'){
    for(const [value,path] of [[applicationOrigin,''],[publicIssuer,'/realms/agenttrust']]){
      if(value.length>300||!/^[\x21-\x7e]+$/.test(value))invalid();
      let u:URL;try{u=new URL(value)}catch{invalid();throw Error('INVALID_OIDC_CONFIGURATION')}
      const host=u.hostname;
      if(!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)||/^[0-9.]+$/.test(host)||/\.(localhost|local|internal)$/.test(host)||value!==`https://${host}${path}`)invalid();
    }
  }else invalid();
  return {profile:profile as OidcEndpoints['profile'],applicationOrigin,publicIssuer};
}
export function configuredOidcEndpoints():OidcEndpoints {
  return oidcEndpoints(process.env.NEXT_PUBLIC_STACK_OIDC_PROFILE,process.env.NEXT_PUBLIC_STACK_APPLICATION_ORIGIN,process.env.NEXT_PUBLIC_STACK_PUBLIC_ISSUER);
}
export function oidcLogoutUrl(endpoints:OidcEndpoints):string {
  return endpoints.publicIssuer+'/protocol/openid-connect/logout?client_id=agenttrust-console&post_logout_redirect_uri='+encodeURIComponent(endpoints.applicationOrigin+'/');
}
export function allowedPublicHost(host:string|null,endpoints:OidcEndpoints):boolean {
  return host!==null&&(host===new URL(endpoints.applicationOrigin).host||endpoints.profile==='local-review'&&host==='localhost:4320');
}
export function validateSessionCookie(cookie:string,endpoints:OidcEndpoints):void {
  if(endpoints.profile==='https-review'&&(!/(?:^|;)\s*Secure(?:;|$)/i.test(cookie)||!/(?:^|;)\s*HttpOnly(?:;|$)/i.test(cookie)))throw Error('INVALID_SESSION_COOKIE');
}
