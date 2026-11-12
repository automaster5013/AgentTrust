"""Build/check public fingerprints using only source files and the existing lock."""
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
worker = root / 'services/ai-worker'
sys.path.insert(0, str(worker))
from connector_profiles import execution_profile

tool = root / 'tools/promptfoo'
names = ['connector-policy.mjs', 'connector-server.mjs', 'connector-application.mjs', 'package-lock.json']
parts = [(tool / name).read_text(encoding='utf-8').replace('\r\n', '\n') for name in names]
fingerprint = hashlib.sha256(('recorded-connector-verifier-v1\n' + '\n'.join(parts)).encode('utf-8')).hexdigest()
value = execution_profile(worker, fingerprint)
targets = {worker / 'connector-validator-profile.json': {'validatorProfileSha256': fingerprint},
           worker / 'connector-execution-profile.json': value,
           root / 'services/core-api/src/main/resources/connector-execution-profile.json': value,
           root / 'apps/console/tests/fixtures/connector-execution-profile.json': value}
fixture = json.loads((tool / 'connector-cases.json').read_text(encoding='utf-8'))
targets[worker / 'connector-cases.json'] = fixture
targets[root / 'services/core-api/src/test/resources/connector-cases.json'] = fixture
targets[root / 'apps/console/tests/fixtures/connector-cases.json'] = fixture
for path, data in targets.items():
    content = (json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
    if '--check' in sys.argv:
        if not path.is_file() or path.read_bytes().replace(b'\r\n', b'\n') != content:
            raise SystemExit('Connector execution profile differs')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
