"""Build or check public recorded-text source fingerprints without importing runtime services."""
import importlib.util
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
worker = root / 'services/ai-worker'
sys.path.insert(0, str(worker))
from recorded_profiles import execution_profile

content = (json.dumps(execution_profile(), ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
targets = [root / 'services/core-api/src/main/resources/recorded-text-execution-profile.json',
           worker / 'recorded-text-execution-profile.json',
           root / 'apps/console/tests/fixtures/recorded-text-execution-profile.json']
if '--check' in sys.argv:
    if any(not path.is_file() or path.read_bytes().replace(b'\r\n', b'\n') != content for path in targets):
        raise SystemExit('Recorded text execution profile differs')
else:
    for path in targets:
        path.write_bytes(content)
