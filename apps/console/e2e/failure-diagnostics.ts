// Public classifications only: never return an exception, response body or URL.
export function failureDiagnostics(error?:{name?:string;message?:string}){
 const message=typeof error?.message==='string'?error.message.slice(0,65536):'';
 const names=['Error','TimeoutError','SyntaxError','AssertionError','TypeError'];
 const patterns={jsonParse:/Unexpected token|Unexpected end of JSON|not valid JSON/i,
  responseBodyUnavailable:/getResponseBody|No resource with given identifier|Response body is unavailable/i,
  responseWaitTimeout:/waitForResponse.*Timeout|Timeout.*waitForResponse/i,
  actionTimeout:/locator\.click.*Timeout|Timeout.*locator\.click/i,
  closedContext:/Target page, context or browser has been closed|context.*destroyed/i,
  abortedRequest:/ERR_ABORTED|ERR_FAILED|request.*aborted/i,
  disabledElement:/element is not enabled/i,detachedElement:/not attached|element was detached/i,
  testTimeout:/Test timeout/i,strictLocator:/strict mode violation/i};
 return {errorKind:error?.name&&names.includes(error.name)?error.name:message?'other':'none',
  ...Object.fromEntries(Object.entries(patterns).map(([key,pattern])=>[key,pattern.test(message)])) as Record<keyof typeof patterns,boolean>};
}
