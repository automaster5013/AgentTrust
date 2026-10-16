// Fixed fixture origin/path policy; query values are never returned separately or logged.
const realms=new Map([['identity.example.com','agenttrust'],['enterprise.example.net','enterprise-synthetic']]);
export function fixturePath(host,raw){
 if(!['console.example.com',...realms.keys()].includes(host)||typeof raw!=='string'||raw.length>8192
    ||!/^\/[\x21-\x7e]*$/.test(raw)||raw.startsWith('//')||raw.includes('\\'))return null;
 const path=raw.split('?',1)[0];
 if(/%(?:2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(path))return null;
 let parsed;try{parsed=new URL(raw,'https://'+host)}catch{return null}
 if(parsed.origin!=='https://'+host||parsed.pathname!==path||parsed.hash||parsed.username||parsed.password)return null;
 const realm=realms.get(host);
 if(realm&&!path.startsWith('/realms/'+realm+'/')&&!path.startsWith('/resources/'))return null;
 return path;
}
