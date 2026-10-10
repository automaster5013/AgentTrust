"""Publish only immutable references. Registry runtime verification is a separate stage."""
import hashlib,json,pathlib,re
directory=pathlib.Path('stack-delivery')
revision=(directory/'revision.txt').read_text().strip();assert re.fullmatch('[a-f0-9]{40}',revision)
images={name:(directory/(name+'.txt')).read_text().strip() for name in ['core-api','ai-worker','console','opa','identity','gateway','object-store','database']}
for name,image in images.items():assert re.fullmatch(r'ghcr\.io/[a-z0-9-]+/agenttrust-'+name+r'@sha256:[a-f0-9]{64}',image)
identity=json.loads((directory/'runtime-identity.json').read_text());assert identity['revision']==revision and identity['images']==images and identity['runtimeImageIdentityVerified'] is True
assert identity['identityProvider']=='keycloak'
manifest={'schemaVersion':1,'revision':revision,'images':images,'sourceIntegrationPassed':True,'registryImagesRuntimeVerified':True,'serverDeployed':False,'identityProvider':'keycloak','evaluationEngine':'python-synthetic-and-local-model','localProviderInferenceVerified':True,'localProviders':['ollama','openai-compatible'],'paidApiCallsVerified':False,'messaging':'nats-jetstream','policyEngine':'opa-rego','gateway':'spring-webflux','requestQuota':'redis-atomic','objectStorage':'minio-versioned','evidenceRetention':'compliance-7-days','similaritySearch':'pgvector-cosine','featureVersion':'rule-features-v1','evaluationVerifier':'promptfoo-0.124.1-synthetic','observability':'otel-prometheus-tempo-loki-grafana','observabilityPrivacyReadbackVerified':True,'imageSecurityVerified':False,'keylessSignaturesVerified':False,'sbomAttestationsVerified':False,'deliveryStatus':'runtime-verified-security-pending'}
data=(json.dumps(manifest,indent=2)+'\n').encode();(directory/'manifest.json').write_bytes(data);(directory/'manifest.sha256').write_text(hashlib.sha256(data).hexdigest()+'  manifest.json\n')
print(json.dumps({'manifestCreated':True,'images':len(images),'serverDeployed':False}))
