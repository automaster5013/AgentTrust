// Keep only fixed route classes and bounded numeric timings, never a URL or body.
const kinds=['identity-bootstrap','oidc-callback','campaign-admission','campaign-review'] as const;
const events=['response','finished','failed'] as const;
const failures=['none','aborted','failed','connection-reset','timeout','other'] as const;
const timingKeys=['domainLookupStart','domainLookupEnd','connectStart','secureConnectionStart','connectEnd','requestStart','responseStart','responseEnd'] as const;
export function diagnosticRequestKind(rawUrl:string,method:string){
 try{
  const url=new URL(rawUrl);if(url.origin!=='http://127.0.0.1:4320'||url.username||url.password)return null;
  if(method==='GET'&&url.pathname==='/backend/me')return 'identity-bootstrap';
  if(method==='GET'&&url.pathname==='/backend/login/oauth2/code/keycloak')return 'oidc-callback';
  if(method==='POST'&&url.pathname==='/backend/campaigns')return 'campaign-admission';
  if(method==='POST'&&/^\/backend\/campaigns\/[a-f0-9-]{36}\/reviews$/.test(url.pathname))return 'campaign-review';
 }catch{/* Malformed input has no diagnostic route. */}
 return null;
}
export function diagnosticFailure(raw:unknown){
 return raw==='net::ERR_ABORTED'?'aborted':raw==='net::ERR_FAILED'?'failed':raw==='net::ERR_CONNECTION_RESET'?'connection-reset':raw==='net::ERR_TIMED_OUT'?'timeout':raw==null?'none':'other';
}
export function sanitizedNetworkDiagnostic(raw:unknown){
 if(!raw||typeof raw!=='object')return null;const input=raw as Record<string,unknown>;
 if(!kinds.includes(input.kind as typeof kinds[number])||!events.includes(input.event as typeof events[number]))return null;
 const timing:Partial<Record<typeof timingKeys[number],number>>={};
 if(input.timing&&typeof input.timing==='object')for(const key of timingKeys){const value=(input.timing as Record<string,unknown>)[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=-1&&value<=300000)timing[key]=Math.round(value*1000)/1000}
 return {kind:input.kind as typeof kinds[number],event:input.event as typeof events[number],status:typeof input.status==='number'&&Number.isInteger(input.status)&&input.status>=100&&input.status<=599?input.status:null,failure:failures.includes(input.failure as typeof failures[number])?input.failure as typeof failures[number]:'other',timing};
}
