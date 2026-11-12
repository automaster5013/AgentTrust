"""Independent execution identity; historical fixed/reference snapshots stay intact."""
import hashlib
import pathlib
from recorded_evaluator import canonical


def execution_profile(root=None):
    root = root or pathlib.Path(__file__).parent
    sources = {name: hashlib.sha256((root / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
               for name in ['recorded_evaluator.py', 'recorded_worker.py', 'recorded_application.py', 'recorded_profiles.py']}
    definition = {'schemaVersion': 1, 'contract': 'recorded-text-execution-profile-v1', 'provider': 'synthetic',
                  'sourceSha256': sources, 'maxCases': 2, 'maxRulesPerCase': 4, 'inputUtf8Bytes': 512,
                  'outputUtf8Bytes': 512, 'ruleValueUtf8Bytes': 64, 'caseJsonBytes': 2048, 'datasetJsonBytes': 4096,
                  'jobJsonBytes': 4096, 'executionDeadlineSeconds': 120, 'evaluationTimeoutSeconds': 1,
                  'maxAttempts': 1, 'comparison': 'case-sensitive-literal-unmodified-Unicode',
                  'arbitraryCodeAllowed': False, 'callerSelectedUrlAllowed': False, 'providerCallsAllowed': False}
    return {'definition': definition, 'contentSha256': hashlib.sha256(canonical(definition)).hexdigest()}
