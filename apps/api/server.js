import { CI } from './ci.js';
import { compareRuns } from '../../packages/evaluator/comparison.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PgStore } from './pg-store.js';
import { Auth,cookieToken,sessionCookie } from './auth.js';
import { pool } from './database.js';
import { InputError } from '../../packages/contracts/index.js';
import { sampleDataset } from '../../packages/contracts/samples.js';

const webRoot=new URL('../web/',import.meta.url);
const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css']};
async function body(req) {
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw new InputError('Content-Type must be application/json.',415);
  if(req.headers['x-agenttrust-request']!=='local-ui') throw new InputError('Missing local request header.',403);
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>262144)throw new InputError('JSON body exceeds 256 KiB.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('Invalid JSON body.');}
}
export function createApp({database,store=new PgStore(database),auth=new Auth(database),ci=new CI(database)}={}) {
  if(!database) throw new Error('PostgreSQL database is required.');
  const server=createServer(async(req,res)=>{
    const traceId=randomUUID();
    const headers={
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','X-Trace-Id':traceId
    };
    const send=(code,data,extra={})=>{res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));};
    try {
      const authority=/^127\.0\.0\.1:(\d+)$/.exec(req.headers.host||'');
      const port=Number(authority?.[1]);
      // Container NAT can translate the host port; still require a loopback Host and deny foreign origins.
      if(!authority||port<1024||port>65535) throw new InputError('Use the loopback address 127.0.0.1.',403);
      if(process.env.CONTAINER_MODE!=='true'&&port!==req.socket.localPort) throw new InputError('Unexpected host port.',403);
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`) throw new InputError('Cross-origin requests are denied.',403);
      const path=new URL(req.url,`http://${req.headers.host}`).pathname;
      if(req.method==='GET'&&assets[path]){const[file,type]=assets[path];res.writeHead(200,{...headers,'Content-Type':`${type}; charset=utf-8`});res.end(await readFile(new URL(file,webRoot)));return;}
      if(req.method==='GET'&&path==='/health') {await database.query('SELECT 1');return send(200,{status:'ok',mode:'local-mock',persistent:true});}
      if(req.method==='POST'&&path==='/v1/auth/login') {
        const input=await body(req);
        if(!input||typeof input!=='object'||Object.keys(input).length!==1||typeof input.accessKey!=='string') throw new InputError('Expected an accessKey.');
        const session=await auth.login(input.accessKey);return send(200,{authenticated:true},{'Set-Cookie':sessionCookie(session.token)});
      }
      const token=cookieToken(req);
      const context=req.headers.authorization?await ci.authenticate(/^Bearer (.+)$/.exec(req.headers.authorization)?.[1]):await auth.authenticate(token);
      if(context.role==='ci' && !(req.method==='POST'&&path==='/v1/release-gate'))throw new InputError('CI credentials can only check release gates.',403);
      if(req.method==='GET'&&path==='/v1/release-receipts')return send(200,await ci.receipts(context));
      const receiptMatch=/^\/v1\/release-receipts\/([a-zA-Z0-9-]+)$/.exec(path);
      if(req.method==='GET'&&receiptMatch)return send(200,await ci.receipt(context,receiptMatch[1]));
      if(req.method==='GET'&&path==='/v1/ci-credentials')return send(200,await ci.list(context));
      if(req.method==='POST'&&path==='/v1/ci-credentials')return send(201,await ci.create(context,await body(req)));
      const ciRevoke=/^\/v1\/ci-credentials\/([a-zA-Z0-9-]+)\/revoke$/.exec(path);
      if(req.method==='POST'&&ciRevoke){await body(req);return send(200,await ci.revoke(context,ciRevoke[1]));}
      if(req.method==='POST'&&path==='/v1/release-gate')return send(200,await ci.check(context,await body(req)));
      if(req.method==='POST'&&path==='/v1/auth/logout'){await body(req);await auth.logout(token,context);return send(200,{authenticated:false},{'Set-Cookie':sessionCookie('',true)});}
      if(req.method==='GET'&&path==='/v1/me') return send(200,context);
      if(req.method==='GET'&&path==='/v1/catalog') return send(200,await store.catalog(context));
      if(req.method==='GET'&&path==='/v1/sample-dataset') return send(200,sampleDataset);
      if(req.method==='GET'&&path==='/v1/runs') return send(200,await store.listRuns(context));
      if(req.method==='GET'&&path==='/v1/audit-events') return send(200,await store.auditEvents(context));
      if(req.method==='GET'&&path==='/v1/usage') return send(200,await store.usage(context));
      if(req.method==='POST'&&path==='/v1/compare'){
        const input=await body(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.candidateRunId!=='string')throw new InputError('candidateRunId is required.');
        const candidate=await store.getRun(context,input.candidateRunId);
        const baseline=input.baselineRunId?await store.getRun(context,input.baselineRunId):undefined;
        if(path==='/v1/compare'&&!baseline) throw new InputError('baselineRunId is required.');
        return send(200,compareRuns(baseline,candidate));
      }
      const kind={'/v1/agent-versions':'agent','/v1/dataset-versions':'dataset','/v1/policy-versions':'policy'}[path];
      if(req.method==='POST'&&kind) return send(201,await store.createVersion(context,kind,await body(req)));
      if(req.method==='POST'&&path==='/v1/runs'){const result=await store.createRun(context,await body(req),req.headers['idempotency-key']);return send(result.replay?200:202,result.run);}
      const match=/^\/v1\/runs\/([a-zA-Z0-9-]+)(?:\/(results|gate|cancel))?$/.exec(path);
      if(req.method==='POST'&&match?.[2]==='cancel'){await body(req);return send(200,await store.cancel(context,match[1]));}
      if(req.method==='GET'&&match&&match[2]!=='cancel'){const run=await store.getRun(context,match[1]);return send(200,match[2]?run[match[2]]:run);}
      throw new InputError('Endpoint not found.',404);
    } catch(error) {
      if(!(error instanceof InputError)) console.error(`API request failed (${error.code||'runtime'}), trace ${traceId}.`);
      send(error instanceof InputError?error.status:503,{error:error instanceof InputError?error.message:'Service unavailable.',traceId});
    }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||4310);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535.');
  const database=pool(process.env.DATABASE_URL);const server=createApp({database});
  await database.query('SELECT 1');
  server.listen(port,process.env.CONTAINER_MODE==='true'?'0.0.0.0':'127.0.0.1',()=>console.log(`AgentTrust authenticated local workspace: http://127.0.0.1:${port}`));
  const stop=()=>{server.close(async()=>{await database.end();});server.closeAllConnections();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
