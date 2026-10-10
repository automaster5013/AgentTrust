"""Bind the Rego policy bytes to both OPA data and Java's trusted metadata."""
import argparse,hashlib,json,pathlib,re
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args();root=pathlib.Path(__file__).resolve().parent.parent
source=root/'services/opa/policies/release.rego';digest='sha256:'+hashlib.sha256(source.read_bytes()).hexdigest();version=(root/'services/opa/policy-version.txt').read_text().strip();assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version);value={'agenttrust':{'policy':{'version':version,'digest':digest}}};targets=[root/'services/opa/policies/metadata.json',root/'services/core-api/src/main/resources/policy-metadata.json']
for path in targets:
 if args.check:assert json.loads(path.read_text(encoding='utf-8'))==value
 else:path.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'completed':True,'policyVersion':version,'policyDigest':digest,'mode':'check' if args.check else 'generate'}))
