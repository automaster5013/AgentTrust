"""Classify one authenticated failed Main HTTPS fixture artifact without private values."""
import hashlib,io,json,os,pathlib,re,shutil,urllib.error,urllib.parse,urllib.request,zipfile
from stack_https_fixture_diagnostics import public_probe_failure, public_oidc_failure_category


def sanitize_summary(value, revision):
    assert value['sourceRevision'] == revision and value['completed'] is False
    assert value['phase'] == 'actual-federated-evaluation-approval-and-revocation'
    assert value['privateInputsPrinted'] is False
    result = {'phase': value['phase'], 'completed': False}
    error = value.get('errorType')
    assert isinstance(error, str) and re.fullmatch('[A-Za-z][A-Za-z0-9]{0,63}', error)
    result['errorType'] = error
    if 'callbackFailureCategory' in value:
        category = value['callbackFailureCategory']
        assert isinstance(category, str)
        result['callbackFailureCategory'] = public_oidc_failure_category(category.encode('ascii'))
    for key in ['sourceRuntimeUnchanged', 'sourceBusinessTablesUnchanged',
                'ownedContainersNetworkAndPrivateFilesRemoved', 'protocolFailureFrameRefused',
                'failureCategoryCapturedFromOwnedCoreOnly', 'callbackFailureCategoryUnavailable',
                'callbackFailureCategoryRefused']:
        if key in value:
            assert type(value[key]) is bool
            result[key] = value[key]
    if 'failedProcessExitCode' in value:
        code = value['failedProcessExitCode']
        assert type(code) is int and -128 <= code <= 255
        result['failedProcessExitCode'] = code
    if 'protocolFailure' in value:
        result['protocolFailure'] = public_probe_failure(json.dumps(value['protocolFailure']).encode())
    return result


def main():
    available = int(next(x.split()[1] for x in pathlib.Path('/proc/meminfo').read_text().splitlines()
                         if x.startswith('MemAvailable:'))) * 1024
    assert available >= 2 * 1073741824 + 256 * 1048576
    assert shutil.disk_usage('.').free >= 22 * 1073741824 + 512 * 1048576
    revision = os.environ['DIAGNOSTIC_REVISION']; run_id = os.environ['DIAGNOSTIC_RUN_ID']
    assert re.fullmatch('[a-f0-9]{40}', revision) and re.fullmatch('[1-9][0-9]{0,14}', run_id)
    base = 'https://api.github.com/repos/automaster5013/AgentTrust/'
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'}
    def get(path):
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=30) as response:
            raw = response.read(1048577)
        assert len(raw) <= 1048576
        return json.loads(raw)
    run = get('actions/runs/' + run_id)
    assert run['head_sha'] == revision and run['head_branch'] == 'main' and run['event'] == 'push'
    assert run['path'] == '.github/workflows/original-stack.yml'
    assert run['status'] == 'completed' and run['conclusion'] == 'failure'
    jobs = get('actions/runs/' + run_id + '/jobs?per_page=100')['jobs']
    integration = next(j for j in jobs if j['name'] == 'integration')
    assert integration['conclusion'] == 'failure'
    assert any(s['name'] == 'Verify actual TLS OIDC login in a fresh portless fixture'
               and s['conclusion'] == 'failure' for s in integration['steps'])
    artifacts = get('actions/runs/' + run_id + '/artifacts?per_page=100')['artifacts']
    selected = [a for a in artifacts if a['name'] == 'original-stack-diagnostics-' + revision and not a['expired']]
    assert len(selected) == 1; artifact = selected[0]; assert artifact['size_in_bytes'] <= 4194304
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args): return None
    opener = urllib.request.build_opener(NoRedirect())
    try:
        opener.open(urllib.request.Request(base + 'actions/artifacts/' + str(artifact['id']) + '/zip', headers=headers), timeout=30)
        raise AssertionError('missing artifact redirect')
    except urllib.error.HTTPError as error:
        assert error.code == 302; location = error.headers['Location']; url = urllib.parse.urlsplit(location)
        assert url.scheme == 'https' and url.hostname and not url.username and not url.password and url.port in [None, 443]
        assert url.hostname.endswith('.blob.core.windows.net') or url.hostname.endswith('.actions.githubusercontent.com')
    with opener.open(location, timeout=30) as response: raw = response.read(4194305)
    assert len(raw) <= 4194304 and 'sha256:' + hashlib.sha256(raw).hexdigest() == artifact['digest']
    reports = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        assert len(entries) <= 256 and len(entries) == len(set(archive.namelist()))
        assert sum(e.file_size for e in entries) <= 16777216
        for entry in entries:
            path = pathlib.PurePosixPath(entry.filename)
            assert not entry.flag_bits & 1 and entry.external_attr >> 16 & 0o170000 != 0o120000
            assert not path.is_absolute() and '..' not in path.parts
            if re.fullmatch(r'(?:\.local/)?stack-https-identity-[a-f0-9-]{36}/summary\.json', entry.filename):
                assert entry.file_size <= 1048576
                reports.append(sanitize_summary(json.loads(archive.read(entry)), revision))
    assert len(reports) == 1
    print(json.dumps({'completed': True, 'scope': 'failure classification only', 'revision': revision,
        'sourceRunId': int(run_id), 'artifactId': artifact['id'], 'archiveDigestVerified': True,
        'fixtureOrBrowserRerunPerformed': False, 'priorFailureRelabeledPassed': False, 'reports': reports}))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'completed': False, 'errorType': type(error).__name__, 'rawBodyUrlOrErrorPrinted': False}))
        raise SystemExit(1)
