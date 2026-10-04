export function localSmokeBase(port=process.env.PORT??'4310'){
  if(typeof port!=='string'||!/^[1-9][0-9]{3,4}$/.test(port)||Number(port)<1024||Number(port)>65535||String(Number(port))!==port)throw new Error('A valid local smoke port is required.');
  return 'http://127.0.0.1:'+port;
}
export async function fetchLocalSmoke(base,path,options={}){
  const target=new URL(base);
  if(target.origin!==localSmokeBase(target.port)||target.pathname!=='/'||target.username||target.password||target.search||target.hash||typeof path!=='string'||!/^\/(?!\/)/.test(path))throw new Error('Local smoke requests require a loopback API target.');
  const url=new URL(path,target);
  if(url.origin!==target.origin)throw new Error('Local smoke requests cannot change origin.');
  const deadline=AbortSignal.timeout(10000);
  return fetch(url,{...options,redirect:'error',signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline});
}
