import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {TextDecoder} from 'node:util';
import {auditExport} from '../apps/console/src/lib/audit.ts';
import type {Identity} from '../apps/console/src/lib/contracts.ts';
/** An expected digest binds bytes, not issuer authenticity or deployment permission. */
try{
 const args=process.argv.slice(2),allowed=new Set(['--file','--sha256','--organization','--project']),options=new Map<string,string>();
 if(args.length!==8)throw Error('INVALID_ARGUMENTS');for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||options.has(args[i])||!args[i+1])throw Error('INVALID_ARGUMENTS');options.set(args[i],args[i+1])}
 const uuid=(value:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw Error('INVALID_SCOPE');return value};
 const organizationId=uuid(options.get('--organization')!),projectId=uuid(options.get('--project')!),digest=options.get('--sha256')!;if(!/^[a-f0-9]{64}$/.test(digest))throw Error('INVALID_DIGEST');
 const descriptor=openSync(options.get('--file')!,constants.O_RDONLY|constants.O_NONBLOCK);let bytes:Buffer;
 try{const info=fstatSync(descriptor);if(!info.isFile()||info.size<1||info.size>262144)throw Error('INVALID_FILE');const bounded=Buffer.alloc(262145);let length=0;while(length<bounded.length){const count=readSync(descriptor,bounded,length,bounded.length-length,null);if(!count)break;length+=count}if(length!==info.size||length>262144)throw Error('INVALID_FILE');bytes=bounded.subarray(0,length)}finally{closeSync(descriptor)}
 const contentJson=new TextDecoder('utf-8',{fatal:true}).decode(bytes!);if(Buffer.byteLength(contentJson)!==bytes!.length)throw Error('INVALID_UTF8');
 const user:Identity={username:'offline-audit-verifier',actorId:'00000000-0000-4000-8000-000000000000',organizationId,projectId,role:'viewer',identityProvider:'keycloak',runtime:'java21-spring-boot'};
 const result=await auditExport({contentJson,contentBytes:bytes!.length,contentSha256:digest,organizationId,projectId,signed:false,currentDeploymentAuthority:false},user);
 process.stdout.write(JSON.stringify({completed:true,contentSha256:result.contentSha256,contentBytes:result.contentBytes,recordCount:result.recordCount,hasOlderRecords:result.hasOlderRecords,entireProjectHistory:result.entireProjectHistory,signed:false,issuerAuthenticated:false,currentDeploymentAuthority:false,networkUsed:false})+'\n');
}catch{process.stdout.write(JSON.stringify({completed:false,code:'AUDIT_EXPORT_UNVERIFIED',issuerAuthenticated:false,currentDeploymentAuthority:false,networkUsed:false})+'\n');process.exitCode=1}
