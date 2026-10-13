"""Compare real Java21, TypeScript and Python endpoint policies offline."""
import base64,datetime,importlib.util,json,pathlib,shutil,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parent.parent
DIRECTORY=ROOT/'.local'/('stack-oidc-contract-'+str(uuid.uuid4()));DIRECTORY.mkdir()
report={'completed':False,'networkUsed':False,'runtimeModified':False,'privateInputsMounted':False}
origin='https://console.example.com';issuer='https://identity.example.com/realms/agenttrust'
cases=[['https-review',origin,issuer,True],['local-review','http://127.0.0.1:4320','http://127.0.0.1:4322/realms/agenttrust',True]]
for value in ['http://console.example.com','https://user@console.example.com','https://console.example.com:443','https://console.example.com/','https://console.example.com?x=1','https://console.example.com#x','https://127.0.0.1','https://[::1]','https://console.local','https://console.internal','https://console.localhost','https://*.example.com','https://CONSOLE.example.com','https://console.example.com\\evil','https://console.example.com\n','https://console.example.com/%2f','https://console%2eexample.com']:
 cases.append(['https-review',value,issuer,False])
for value in ['https://identity.example.com','https://identity.example.com/realms/other','https://identity.example.com/realms/agenttrust/','https://identity.example.com/realms/%61genttrust']:
 cases.append(['https-review',origin,value,False])
cases.extend([['production',origin,issuer,False],['local-review','http://localhost:4320','http://127.0.0.1:4322/realms/agenttrust',False]])
(DIRECTORY/'cases.json').write_text(json.dumps(cases),encoding='utf-8')
(DIRECTORY/'cases.tsv').write_text('\n'.join('\t'.join(base64.b64encode(v.encode()).decode() for v in row[:3]) for row in cases)+'\n',encoding='utf-8')
(DIRECTORY/'ContractProbe.java').write_text("""package dev.agenttrust.core;import java.nio.file.*;import java.util.*;public class ContractProbe {public static void main(String[] args)throws Exception {for(String line:Files.readAllLines(Path.of("/fixtures/cases.tsv"))){var v=line.split("\\t");String[] s=new String[3];for(int i=0;i<3;i++)s[i]=new String(Base64.getDecoder().decode(v[i]),java.nio.charset.StandardCharsets.UTF_8);try{OidcEndpointPolicy.configure(s[0],s[1],s[2],true);System.out.println("true");}catch(IllegalArgumentException e){System.out.println("false");}}}}""",encoding='utf-8')
(DIRECTORY/'probe.mjs').write_text("""import{readFileSync}from'node:fs';import{oidcEndpoints}from'/policy/oidc-endpoints.ts';const cases=JSON.parse(readFileSync('/fixtures/cases.json','utf8'));console.log(JSON.stringify(cases.map(([p,o,i])=>{try{oidcEndpoints(p,o,i);return true;}catch{return false;}})));""",encoding='utf-8')
def docker(image,mounts,command):
 args=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--pids-limit','64','--tmpfs','/tmp:size=32m,mode=1777,exec','--mount','type=bind,source='+str(DIRECTORY)+',target=/fixtures,readonly']
 for source,target in mounts:args+=['--mount','type=bind,source='+str(source)+',target='+target+',readonly']
 result=subprocess.run(args+[image]+command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=60,check=True);return result.stdout.strip()
try:
 before=shutil.disk_usage(ROOT).free;assert before>=23622320128
 java=docker('maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237',[(ROOT/'services/core-api/src/main/java/dev/agenttrust/core/OidcEndpointPolicy.java','/policy/OidcEndpointPolicy.java')],['sh','-c','javac -d /tmp /policy/OidcEndpointPolicy.java /fixtures/ContractProbe.java && java -Xmx64m -cp /tmp dev.agenttrust.core.ContractProbe'])
 node=docker('node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',[(ROOT/'apps/console/src/lib/oidc-endpoints.ts','/policy/oidc-endpoints.ts')],['node','--experimental-strip-types','/fixtures/probe.mjs'])
 spec=importlib.util.spec_from_file_location('image_policy',ROOT/'scripts/stack-oidc-image-config.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);python=[]
 for profile,o,i,_ in cases:
  try:module.validate(profile,o,i);python.append(True)
  except ValueError:python.append(False)
 expected=[row[3] for row in cases];java_results=[line=='true' for line in java.splitlines() if line in ['true','false']];node_results=json.loads(node);report['resultLengths']={'Java21':len(java_results),'TypeScript':len(node_results),'Python':len(python)};report['disagreementIndices']=[index for index,e in enumerate(expected) if java_results[index]!=e or node_results[index]!=e or python[index]!=e];assert java_results==node_results==python==expected
 report.update(completed=True,cases=len(cases),policyExecutions=3*len(cases),accepted=sum(expected),rejected=len(cases)-sum(expected),implementations=['Java21','TypeScript','Python'],cDriveFreeBytes=shutil.disk_usage(ROOT).free)
except Exception as error:report.update(errorType=type(error).__name__,code='OIDC_CONTRACT_UNVERIFIED')
finally:
 report['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(DIRECTORY/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'completed':report['completed'],'cases':report.get('cases'),'reportPath':str(DIRECTORY/'summary.json')}))
if not report['completed']:raise SystemExit(1)
