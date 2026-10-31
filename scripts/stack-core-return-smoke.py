"""CI-only previous Core HTTP/browser return on the disposable synthetic V18 stack.

Refuses locally before Docker, secrets, private files or network calls. The
previous image is a pinned test subject, not a newly signature-verified release.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import uuid
import time
from stack_ci_return_guard import require_hosted
from stack_core_return_flow import verify
from stack_v18_transition_probe import BASELINE_REFERENCE, BASELINE_REVISION

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ['compose.stack.yaml', 'compose.stack.identity.yaml', 'compose.stack.gateway.yaml',
         'compose.stack.object.yaml', 'compose.stack.observability.yaml', 'compose.stack.signing.yaml']


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--execute', action='store_true'); args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'completed': True, 'readOnlyPlan': True, 'executed': False,
                          'actualDeploymentPerformed': False, 'requires': 'disposable GitHub-hosted --execute'})); return 0
    try:
        require_hosted(ROOT)
    except ValueError:
        print(json.dumps({'completed': False, 'executed': False, 'code': 'HOSTED_SYNTHETIC_RETURN_ONLY', 'actualDeploymentPerformed': False})); return 1
    directory = ROOT / '.local' / ('stack-core-return-' + str(uuid.uuid4())); directory.mkdir(mode=0o700)
    report = {'completed': False, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'synthetic': True, 'actualDeploymentPerformed': False, 'operatingRecoveryVerified': False,
              'baselineSignatureVerified': False, 'healthyRollbackGuaranteed': False,
              'candidateRestored': False, 'credentialsRecorded': False, 'stage': 'preflight'}

    deadline = time.monotonic() + 1800
    restore_deadline = None

    def run(command, *, data=None, timeout=60, env=None):
        limit = restore_deadline if report['stage'] == 'switch-candidate' and restore_deadline else deadline
        remaining = limit - time.monotonic()
        if remaining <= 0: raise TimeoutError('CORE_RETURN_BUDGET_EXPIRED')
        result = subprocess.run(command, cwd=ROOT, input=data, capture_output=True, timeout=min(timeout, remaining), env=env)
        if result.returncode:
            report['failedCommandExitCode'] = result.returncode
            report['failedCommandStage'] = report['stage']
            if command[:2] == ['python3', 'scripts/stack-http-smoke.py']:
                try:
                    frame = json.loads(result.stdout.decode().splitlines()[-1])
                    report['httpFailure'] = {key: frame.get(key) for key in ('completed','failedStage','errorType','unexpectedHttpStatus','responseCode','ownSessionsLoggedOut')}
                except Exception: report['httpFailureSummaryUnavailable'] = True
            raise RuntimeError('CORE_RETURN_COMMAND_UNVERIFIED')
        return result.stdout

    def inspect(name):
        return json.loads(run(['docker', 'inspect', name]))[0]

    def sql(query):
        return run(['docker', 'exec', '-i', 'agenttrust-stack-db-1', 'psql', '-X', '-q', '-U',
                    'agenttrust_stack', '-d', 'agenttrust_stack', '-At', '-v', 'ON_ERROR_STOP=1'], data=query.encode())

    def capture():
        quiet_deadline = min(deadline, time.monotonic() + 90)
        while sql("BEGIN READ ONLY;SELECT (SELECT count(*) FROM stack_runs WHERE state='queued')+(SELECT count(*) FROM stack_campaigns WHERE state='queued');ROLLBACK;").decode().strip() != '0':
            if time.monotonic() >= quiet_deadline: raise ValueError('SYNTHETIC_PENDING_WORK_NOT_QUIESCENT')
            time.sleep(2)
        tables = json.loads(sql("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename<>'flyway_schema_history';"))
        assert len(tables) == 20 and all(re.fullmatch('[a-z][a-z0-9_]{0,62}', name) for name in tables)
        queries = ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout='3s';",
                   "SELECT json_build_object('ledger',encode(sha256(convert_to(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY installed_rank),'UTF8')),'hex')) FROM flyway_schema_history t;"]
        for table in tables:
            queries.append("SELECT json_build_object('table','" + table + "','rows',coalesce(json_agg(h ORDER BY h),'[]'::json)) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM public.\"" + table + '" t LIMIT 10001) x;')
        raw = sql(''.join(queries) + 'ROLLBACK;'); assert len(raw) <= 2 * 1024 * 1024
        frames = [json.loads(line) for line in raw.decode().splitlines()]
        values = {v['table']: v['rows'] for v in frames[1:]}
        assert set(values) == set(tables) and all(len(rows) <= 10000 and all(re.fullmatch('[a-f0-9]{64}', h) for h in rows) for rows in values.values())
        return {'ledger': frames[0]['ledger'], 'tables': values}

    try:
        core = inspect('agenttrust-stack-core-api-1'); labels = core['Config']['Labels']
        assert labels['com.docker.compose.project'] == 'agenttrust' and labels['com.docker.compose.service'] == 'stack-core-api'
        assert pathlib.Path(labels['com.docker.compose.project.working_dir']).resolve() == ROOT
        assert [pathlib.Path(p).resolve() for p in labels['com.docker.compose.project.config_files'].split(',')] == [ROOT / p for p in FILES]
        assert core['State']['Running'] and core['State']['Health']['Status'] == 'healthy'
        candidate = core['Image']; assert re.fullmatch('sha256:[a-f0-9]{64}', candidate)
        ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=agenttrust']).decode().split()
        others = {v['Id']: (v['Image'], v['State']['StartedAt']) for v in json.loads(run(['docker', 'inspect', *ids])) if v['Id'] != core['Id']}
        assert len(others) >= 10
        paths = [ROOT / p for p in FILES] + [ROOT / '.local/stack/stack.env', ROOT / '.local/stack/identity.env']
        assert all(p.is_file() and not p.is_symlink() for p in paths)
        hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
        run(['docker', 'pull', BASELINE_REFERENCE], timeout=300)
        old = json.loads(run(['docker', 'image', 'inspect', BASELINE_REFERENCE]))[0]
        assert BASELINE_REFERENCE in old.get('RepoDigests', []) and old['Config']['Labels']['org.opencontainers.image.revision'] == BASELINE_REVISION
        images = {'previous': old['Id'], 'candidate': candidate}
        assert all(re.fullmatch('sha256:[a-f0-9]{64}', value) for value in images.values()) and images['previous'] != images['candidate']
        compose = ['docker', 'compose', '--project-name', 'agenttrust', '--project-directory', str(ROOT)]
        for path in paths[-2:]: compose += ['--env-file', str(path)]
        for path in paths[:-2]: compose += ['-f', str(path)]
        expected_id = core['Id']

        def switch(mode):
            nonlocal expected_id, restore_deadline
            report['stage'] = 'switch-' + mode
            if mode == 'candidate': restore_deadline = time.monotonic() + 300
            observed = subprocess.run(['docker', 'inspect', 'agenttrust-stack-core-api-1'], cwd=ROOT, capture_output=True, timeout=20)
            if observed.returncode == 0:
                current = json.loads(observed.stdout)[0]
                assert current['Config']['Labels']['com.docker.compose.project.working_dir'] == str(ROOT)
                assert current['Image'] in images.values()
                if mode == 'previous': assert current['Id'] == expected_id
            else:
                assert mode == 'candidate' and not run(['docker', 'ps', '-aq', '--filter', 'name=^/agenttrust-stack-core-api-1$']).strip()
            assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() == value for p, value in hashes.items())
            override = directory / (mode + '.json')
            override.write_text(json.dumps({'services': {'stack-core-api': {'image': images[mode], 'pull_policy': 'never'}}}), encoding='utf-8'); override.chmod(0o600)
            run([*compose, '-f', str(override), 'up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'stack-core-api'], timeout=240)
            state = inspect('agenttrust-stack-core-api-1'); expected_id = state['Id']
            assert state['Image'] == images[mode] and state['State']['Running'] and state['State']['Health']['Status'] == 'healthy'
            if mode == 'candidate': report['candidateRestored'] = True

        def api(mode):
            report['stage'] = mode + '-http'
            for port in (4321, 4320):
                report['httpProbePort'] = port
                command = ['python3', 'scripts/stack-http-smoke.py', '--base', 'http://127.0.0.1:' + str(port)]
                if mode == 'previous': command += ['--legacy-core-return']
                raw = run(command, timeout=240)
                frames = [json.loads(line) for line in raw.decode().splitlines() if line.startswith('{')]
                assert frames and frames[-1]['completed'] and frames[-1]['ownSessionsLoggedOut'] and frames[-1]['checks'] >= 9

        def browser():
            report['stage'] = 'previous-browser'
            env = dict(os.environ, STACK_E2E_LEGACY_CORE_RETURN='true', STACK_E2E_QUOTA_GUARD='true')
            result = subprocess.run(['npx', 'playwright', 'test', '--grep-invert', '^workspace management'],
                                    cwd=ROOT / 'apps/console', capture_output=True, timeout=max(1, min(900, deadline-time.monotonic())), env=env)
            if result.returncode:
                report['browserProcessFailed'] = True
                raise RuntimeError('PREVIOUS_CORE_BROWSER_UNVERIFIED')
            frames = [json.loads(line) for line in result.stdout.decode().splitlines() if line.startswith('{')]
            assert frames and frames[-1]['completed'] and frames[-1]['tests'] >= 50 and not frames[-1]['failed']
            report['previousBrowserTests'] = frames[-1]['tests']

        report['proof'] = verify(switch, api, browser, capture)
        for identifier, expected in others.items():
            state = inspect(identifier)
            assert (state['Image'], state['State']['StartedAt']) == expected and state['State']['Running'] and state['State']['Health']['Status'] == 'healthy'
        report.update(completed=True, stage='completed', nonCoreContainerIdentitiesPreserved=True)
    except Exception as error:
        report.update(completed=False, errorType=type(error).__name__, code='CORE_RETURN_UNVERIFIED')
    finally:
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (directory / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report))
    return 0 if report['completed'] and report['candidateRestored'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
