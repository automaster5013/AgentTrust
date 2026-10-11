"""Verify all official plugin signatures in an isolated candidate runtime."""
import datetime
import json
import os
import pathlib
import secrets
import subprocess
import uuid

root = pathlib.Path(__file__).resolve().parent.parent
identity = str(uuid.uuid4())
directory = root / '.local' / ('stack-grafana-signatures-' + identity)
directory.mkdir(parents=True, mode=0o700)
password = directory / 'password'
password.write_text(secrets.token_hex(32), encoding='utf-8')
password.chmod(0o644)
lock = root / 'services/grafana/plugins.lock.json'
(directory / 'plugins.lock.json').write_bytes(lock.read_bytes())
(directory / 'plugins.lock.json').chmod(0o644)
name = 'agenttrust-grafana-signatures-' + identity
report = {'completed': False, 'network': 'none', 'hostPortsPublished': False,
          'unsignedPluginsAllowed': False, 'actualDeploymentPerformed': False,
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}


def run(arguments, timeout=120):
    return subprocess.run(arguments, cwd=root, capture_output=True, text=True,
                          encoding='utf-8', errors='replace', timeout=timeout)


probe = r'''
import base64,json,pathlib,time,urllib.request
secret=pathlib.Path('/in/password').read_text()
lock=json.loads(pathlib.Path('/in/plugins.lock.json').read_text())
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def get(path):
    request=urllib.request.Request('http://127.0.0.1:3000'+path,headers={'Authorization':'Basic '+base64.b64encode(('fixture-admin:'+secret).encode()).decode()})
    with opener.open(request,timeout=3) as response:
        assert response.status==200 and response.geturl()==request.full_url
        data=response.read(262145);assert len(data)<=262144
        return json.loads(data)
for attempt in range(45):
    try:
        health=get('/api/health')
        assert health['version']=='13.2.3' and health['database']=='ok'
        break
    except Exception:
        if attempt==44:raise RuntimeError('Candidate did not become healthy') from None
        time.sleep(2)
plugins={p['id']:p for p in get('/api/plugins')}
checked=[]
for expected in lock['plugins']:
    actual=plugins[expected['id']]
    assert actual['info']['version']==expected['version']
    assert actual['signature']=='valid'
    assert actual['signatureType']=='grafana' and actual['signatureOrg']=='Grafana Labs'
    checked.append({'id':expected['id'],'version':expected['version'],'signature':actual['signature']})
print(json.dumps({'version':health['version'],'database':health['database'],'plugins':checked}))
'''
(directory / 'probe.py').write_text(probe, encoding='utf-8')
(directory / 'probe.py').chmod(0o644)
stage = 'image-identity'
try:
    inspected = run(['docker', 'image', 'inspect', 'agenttrust-grafana:local'])
    assert inspected.returncode == 0
    image = json.loads(inspected.stdout)[0]
    report['imageId'] = image['Id']
    revision = os.environ.get('GITHUB_SHA')
    if revision:
        assert image['Config']['Labels']['org.opencontainers.image.revision'] == revision
        report['revision'] = revision
    stage = 'start-isolated-runtime'
    started = run(['docker', 'run', '-d', '--name', name,
                   '--label', 'com.docker.compose.project=agenttrust',
                   '--label', 'agenttrust.fixture=' + identity,
                   '--network', 'none', '--read-only', '--user', '472:0',
                   '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                   '--memory', '1g', '--cpus', '1', '--pids-limit', '128',
                   '--tmpfs', '/var/lib/grafana:size=64m,uid=472,gid=0,mode=0700',
                   '--tmpfs', '/var/log/grafana:size=16m,uid=472,gid=0,mode=0700',
                   '--tmpfs', '/tmp:size=16m,mode=1777',
                   '--mount', 'type=bind,source=' + str(password) + ',target=/run/secrets/fixture-password,readonly',
                   '-e', 'GF_SECURITY_ADMIN_USER=fixture-admin',
                   '-e', 'GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/fixture-password',
                   '-e', 'GF_DEFAULT_APP_MODE=production',
                   '-e', 'GF_PLUGINS_PREINSTALL_DISABLED=true',
                   '-e', 'GF_PLUGINS_PUBLIC_KEY_RETRIEVAL_DISABLED=true',
                   '-e', 'GF_ANALYTICS_REPORTING_ENABLED=false',
                   '-e', 'GF_ANALYTICS_CHECK_FOR_UPDATES=false',
                   '-e', 'GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false', image['Id']])
    assert started.returncode == 0
    stage = 'actual-plugin-signature-check'
    checked = run(['docker', 'run', '--rm', '--network', 'container:' + name,
                   '--user', str(os.getuid()) + ':' + str(os.getgid()) if os.name != 'nt' else '10001:10001',
                   '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                   '--memory', '256m', '--cpus', '1', '--pids-limit', '64',
                   '--mount', 'type=bind,source=' + str(directory) + ',target=/in,readonly',
                   'agenttrust-security:local', 'python', '/in/probe.py'])
    assert checked.returncode == 0
    evidence = json.loads(checked.stdout)
    assert len(evidence['plugins']) == 13
    report.update(completed=True, **evidence)
except Exception as error:
    report.update(failedStage=stage, errorType=type(error).__name__)
finally:
    inspected = run(['docker', 'container', 'inspect', name])
    if inspected.returncode == 0:
        container = json.loads(inspected.stdout)[0]
        assert container['Config']['Labels'].get('agenttrust.fixture') == identity
        removed = run(['docker', 'rm', '-f', container['Id']])
        report['fixtureContainerRemoved'] = removed.returncode == 0
    password.write_text('credential removed', encoding='utf-8')
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (directory / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))
raise SystemExit(0 if report['completed'] and report.get('fixtureContainerRemoved') else 1)
