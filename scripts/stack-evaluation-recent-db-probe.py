"""Hosted disposable candidate: compare the exact API completion window read-only."""
import datetime
import json
import os
import re
import sys
import uuid
from stack_business_fingerprint import sql

try:
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('AGENTTRUST_AUDIT_V17_FIXTURE') != '1' or len(sys.argv) != 5:
        raise ValueError('Hosted fixture required')
    organization, project, start, end = sys.argv[1:]
    if any(str(uuid.UUID(value)) != value for value in (organization, project)):
        raise ValueError('Invalid scope')
    for value in (start, end):
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value):
            raise ValueError('Invalid time')
    if datetime.datetime.fromisoformat(end) - datetime.datetime.fromisoformat(start) != datetime.timedelta(hours=24):
        raise ValueError('Invalid window')
    scope = f"r.organization_id='{organization}' AND r.project_id='{project}'"
    query = f"""WITH observations AS (
      SELECT r.created_at,COALESCE(c.state,r.state) AS state,COALESCE(c.decision,r.decision) AS decision,c.completed_at
      FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE {scope}
    ) SELECT 'recent|'||json_build_object(
      'completedCount',count(*) FILTER(WHERE state IN ('succeeded','failed') AND completed_at BETWEEN '{start}'::timestamptz AND '{end}'::timestamptz),
      'executionErrorCount',count(*) FILTER(WHERE state='failed' AND completed_at BETWEEN '{start}'::timestamptz AND '{end}'::timestamptz),
      'unknownCompletionTimeCount',count(*) FILTER(WHERE state IN ('succeeded','failed') AND completed_at IS NULL),
      'runsSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),''),'UTF8')),'hex') FROM stack_runs r WHERE {scope})
    )::text FROM observations"""
    output = sql("BEGIN READ ONLY;SET LOCAL statement_timeout='2s';" + query + ';ROLLBACK;')
    lines = [line[len('recent|'):] for line in output.splitlines() if line.startswith('recent|')]
    if len(lines) != 1:
        raise ValueError('Incomplete comparison')
    value = json.loads(lines[0])
    if any(type(value[key]) is not int or not 0 <= value[key] <= 100000 for key in ('completedCount','executionErrorCount','unknownCompletionTimeCount')) or not re.fullmatch('[a-f0-9]{64}', value['runsSha256']):
        raise ValueError('Unexpected aggregate')
    print(json.dumps(value))
except Exception:
    print(json.dumps({'completed': False, 'error': 'RECENT_DATABASE_COMPARISON_UNAVAILABLE'}))
    raise SystemExit(2)
