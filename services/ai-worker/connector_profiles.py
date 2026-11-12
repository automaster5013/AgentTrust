"""New immutable connector identity, without rewriting accepted evaluator fingerprints."""
import hashlib
import json
import pathlib
from recorded_evaluator import canonical

def execution_profile(root=None, fingerprint=None):
    root = root or pathlib.Path(__file__).parent
    if fingerprint is None:
        fingerprint = json.loads((root / 'connector-validator-profile.json').read_text(encoding='utf-8'))['validatorProfileSha256']
    if not isinstance(fingerprint, str) or len(fingerprint) != 64 or any(c not in '0123456789abcdef' for c in fingerprint):
        raise ValueError('Invalid connector verifier profile')
    sources = {name: hashlib.sha256((root / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
               for name in ['connector_evaluator.py', 'connector_worker.py', 'connector_application.py', 'connector_profiles.py', 'recorded_evaluator.py']}
    definition = {'schemaVersion': 1, 'contract': 'recorded-connector-execution-profile-v1', 'provider': 'synthetic',
                  'sourceSha256': sources, 'validatorProfileSha256': fingerprint, 'ajvVersion': '8.20.0',
                  'schemaSubset': 'flat-string-object-v1', 'maxCases': 2, 'maxRulesPerCase': 4,
                  'inputUtf8Bytes': 512, 'outputUtf8Bytes': 512, 'ruleValueUtf8Bytes': 64,
                  'maxToolEvents': 4, 'maxAllowedTools': 4, 'maxArgumentProperties': 8,
                  'caseJsonBytes': 3072, 'datasetJsonBytes': 6144, 'jobJsonBytes': 4096,
                  'executionDeadlineSeconds': 120, 'evaluationTimeoutSeconds': 1, 'verifierTimeoutSeconds': 4,
                  'maxAttempts': 1, 'arbitraryCodeAllowed': False, 'callerSelectedUrlAllowed': False,
                  'providerCallsAllowed': False, 'toolExecutionAllowed': False}
    return {'definition': definition, 'contentSha256': hashlib.sha256(canonical(definition)).hexdigest()}
