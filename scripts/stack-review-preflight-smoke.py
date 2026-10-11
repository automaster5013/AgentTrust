"""Prove the reviewer CLI reads real scoped data without changing business rows."""
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import uuid

from stack_campaign_evidence import bounded_json, identifier

ROOT = pathlib.Path(__file__).resolve().parent.parent
report = {'completed': False, 'checks': [], 'businessDataWrites': False,
          'legacyServicesChanged': False, 'credentialsRecorded': False,
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}


def sql(statement):
    result = subprocess.run(
        ['docker', 'exec', '-i', 'agenttrust-stack-db-1', 'psql', '-U', 'agenttrust_stack',
         '-d', 'agenttrust_stack', '-v', 'ON_ERROR_STOP=1', '-At'],
        input=statement, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=15)
    if result.returncode:
        raise ValueError('Business fingerprint unavailable')
    return result.stdout.strip()


def fingerprint():
    tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").splitlines()
    if not 1 <= len(tables) <= 64 or any(not re.fullmatch('[a-z][a-z0-9_]{0,62}', t) for t in tables):
        raise ValueError('Unexpected table set')
    values = {}
    total = 0
    for table in tables:
        prefix = "BEGIN READ ONLY;SET LOCAL statement_timeout='2s';"
        measured = sql(prefix + 'SELECT count(*)::text||\'|\'||coalesce(sum(pg_column_size(t)),0)::text '
                       'FROM "' + table + '" t;ROLLBACK;').splitlines()[-2]
        count, size = map(int, measured.split('|'))
        total += size
        if count > 100000 or size > 16 * 1024 * 1024 or total > 64 * 1024 * 1024:
            raise ValueError('Business fingerprint exceeds bounds')
        value = sql(prefix + 'SELECT count(*)::text||\'|\'||encode(sha256(convert_to('
                    'coalesce(string_agg(to_jsonb(t)::text,E\'\\n\' ORDER BY to_jsonb(t)::text),\'\'),'
                    '\'UTF8\')),\'hex\') FROM "' + table + '" t;ROLLBACK;').splitlines()[-2]
        rows, digest = value.split('|')
        if int(rows) != count or not re.fullmatch('[a-f0-9]{64}', digest):
            raise ValueError('Unexpected fingerprint')
        values[table] = {'rows': count, 'sha256': digest}
    return values


def cli(arguments, expected=0):
    result = subprocess.run([sys.executable, 'scripts/stack-review-preflight.py', *arguments],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=120)
    value = json.loads(result.stdout)
    if result.returncode != expected or value['completed'] != (expected == 0) \
            or value['ownSessionLoggedOut'] is not True or value['businessDataWrites'] is not False \
            or value['deploymentAuthority'] is not False or value['productionReady'] is not False:
        raise ValueError('Reviewer CLI contract unverified')
    return value


try:
    state = json.loads(subprocess.check_output(['docker', 'inspect', 'agenttrust-stack-db-1'], cwd=ROOT))[0]
    if state['Config']['Labels'].get('com.docker.compose.project') != 'agenttrust' \
            or state['Config']['Labels'].get('com.docker.compose.service') != 'stack-db' \
            or state['State']['Health']['Status'] != 'healthy':
        raise ValueError('Unexpected business database')
    # Use a previously completed real-reference campaign; no new evaluations are admitted.
    candidates = sorted((ROOT / '.local').glob('stack-quality-campaign-*/summary.json'),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    reference = next(v for p in candidates if (v := bounded_json(p, 65536)).get('completed') is True
                     and v.get('realLocalInference') is True and len(v.get('campaignIds', [])) == 2)
    campaign = identifier(reference['campaignIds'][0])
    if sql("SELECT count(*) FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id "
           "WHERE r.state='queued' AND c.run_id IS NULL;") != '0':
        raise ValueError('Pending completions prevent read-only verification')
    # Let already admitted archive work finish before measuring the CLI itself.
    # Stability is required before any CLI runs; the after-check remains exact.
    before = fingerprint()
    stable = 0
    deadline = time.monotonic() + 40
    while stable < 2:
        if time.monotonic() > deadline:
            raise TimeoutError('Business baseline did not stabilize')
        time.sleep(3)
        current = fingerprint()
        stable = stable + 1 if current == before else 0
        before = current
    report['businessBaselineStableBeforeCli'] = True
    viewer = cli(['--username', 'demo-viewer'])
    if viewer['role'] != 'viewer' or len(viewer['checks']) != 2:
        raise ValueError('Viewer scope unverified')
    report['checks'].append('viewer authenticates and reads bounded project audit without evaluation writes')
    for username in ['demo-viewer', 'demo-admin']:
        proof = cli(['--username', username, '--campaign', campaign])
        if proof['childArchivesVerified'] != 2 or len(proof['checks']) != 4 \
                or proof['signatureVerified'] is not False or type(proof['currentGateAllowedAtRead']) is not bool:
            raise ValueError('Existing byte verification unverified')
    report['checks'].append('viewer and administrator independently verify existing reference parent/child bytes and current OPA observation')
    refused = cli(['--username', 'other-admin', '--campaign', campaign], 1)
    if refused.get('unexpectedHttpStatus') != 404 or refused['failedStage'] != 'existing-campaign':
        raise ValueError('Foreign campaign was not refused')
    report['checks'].append('foreign organization cannot preflight an existing campaign UUID')
    invalid = cli(['--campaign', 'https://example.invalid/'], 1)
    if invalid['failedStage'] != 'configuration' or 'loginPhase' in invalid:
        raise ValueError('Malformed campaign reached authentication')
    report['checks'].append('noncanonical campaign input fails before authentication or remote requests')
    after = fingerprint()
    if before != after:
        raise ValueError('Business rows changed during read-only checks')
    report['businessTablesUnchanged'] = len(before)
    report['businessFingerprintSha256'] = hashlib.sha256(
        json.dumps(before, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    report['checks'].append('every existing public business table row fingerprint remains unchanged')
    report['completed'] = True
except Exception as error:
    report.update(errorType=type(error).__name__, code='STACK_REVIEW_PREFLIGHT_SMOKE_UNVERIFIED')
finally:
    report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    path = ROOT / '.local' / ('stack-review-preflight-smoke-' + str(uuid.uuid4()) + '.json')
    path.open('x', encoding='utf-8').write(json.dumps(report, indent=2) + '\n')
    print(json.dumps({**report, 'reportPath': str(path)}))
if not report['completed']:
    raise SystemExit(1)
