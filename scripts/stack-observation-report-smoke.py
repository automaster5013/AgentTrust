"""Read existing successful Java receipt evidence; create only a new private HTML report."""
import json
from pathlib import Path
import subprocess
import uuid

root = Path(__file__).resolve().parents[1]
credentials = json.loads((root / '.local/stack/demo-credentials.json').read_text(encoding='utf-8'))
identity = next(item for item in credentials if item['username'] == 'demo-admin')
sources = sorted((root / '.local').glob('stack-campaign-receipt-*/summary.json'), key=lambda p: p.stat().st_mtime, reverse=True)
source = next(p for p in sources if json.loads(p.read_text(encoding='utf-8')).get('completed') and (p.parent / 'inputs/bundle.json').is_file())
evidence = json.loads(source.read_text(encoding='utf-8'))
directory = root / '.local' / ('stack-observation-report-' + str(uuid.uuid4()))
directory.mkdir()
command = ['node', '--experimental-strip-types', str(root / 'scripts/stack-observation-report.ts'),
           '--bundle', str(source.parent / 'inputs/bundle.json'),
           '--trusted-public-key', str(root / '.local/stack/gate-keys/public-key.pem'),
           '--organization', identity['organizationId'], '--project', identity['projectId'],
           '--campaign', evidence['campaignId'], '--output', str(directory / 'report.html')]
result = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding='utf-8', check=True)
summary = json.loads(result.stdout)
assert summary['completed'] and summary['signatureVerified'] and summary['childBytesVerified']
assert summary['trustedKeyId'] == evidence['keyId']
assert summary['currentDeploymentAuthority'] is False and summary['networkUsed'] is False
summary.update(sourceReceiptSummary=source.parent.name, paidApiCalls=False, businessWrites=False)
(directory / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps({'completed': True, 'outputBytes': summary['outputBytes'], 'report': str(directory / 'report.html'), 'businessWrites': False}))
