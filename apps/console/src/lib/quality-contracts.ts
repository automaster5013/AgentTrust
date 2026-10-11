export function referenceText(value:unknown,bytes:number):string{
 if(typeof value!=='string'||!value.trim()||value.includes('\0')||new TextEncoder().encode(value).length>bytes||!value.isWellFormed())throw Error('INVALID_REFERENCE_SAMPLE');return value;
}
export function referenceProfile(value:unknown,provider:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_REFERENCE_PROFILE');
 const p=value as Record<string,unknown>;
 const expected={schemaVersion:1,contract:'reference-execution-profile-v1',provider,model:'qwen3:0.6b',inputReservationTokens:256,outputReservationTokens:128,inputUtf8Bytes:192,referenceUtf8Bytes:128,outputUtf8Bytes:2048,maxCases:2,executionDeadlineSeconds:120,providerTimeoutSeconds:60,verifierTimeoutSeconds:17,maxAttempts:1,arbitraryCodeAllowed:false,callerSelectedUrlAllowed:false,answerComparison:'Unicode-NFC-trim-exact',rawModelOutputRetained:false};
 if(!['ollama','openai-compatible'].includes(provider)||Object.entries(expected).some(([key,item])=>p[key]!==item)||Object.keys(p).length!==Object.keys(expected).length+4||typeof p.validatorProfileSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.validatorProfileSha256)||typeof p.modelSourceManifestDigest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(p.modelSourceManifestDigest)||typeof p.modelRuntimeDigest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(p.modelRuntimeDigest))throw Error('INVALID_REFERENCE_PROFILE');
 const sources=p.sourceSha256;
 const names=['quality_provider.py','quality_evaluator.py','quality_worker.py','quality_application.py','quality_profiles.py','providers.py'];
 if(!sources||typeof sources!=='object'||Array.isArray(sources)||Object.keys(sources).length!==names.length||names.some(name=>typeof (sources as Record<string,unknown>)[name]!=='string'||!/^[a-f0-9]{64}$/.test((sources as Record<string,string>)[name])))throw Error('INVALID_REFERENCE_PROFILE');
 return {...p};
}
