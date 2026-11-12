"""Hosted disposable candidate only: aggregate observations and immutable run fingerprint."""
import json
import os
import re
import sys
import uuid
from stack_business_fingerprint import sql

try:
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('AGENTTRUST_AUDIT_V17_FIXTURE') != '1' or len(sys.argv) != 3:
        raise ValueError('Hosted fixture required')
    organization, project = sys.argv[1:]
    if any(str(uuid.UUID(value)) != value for value in (organization, project)):
        raise ValueError('Invalid scope')
    scope = f"r.organization_id='{organization}' AND r.project_id='{project}'"
    query = f"""WITH observations AS (
      SELECT COALESCE(c.state,r.state) AS state, COALESCE(c.decision,r.decision) AS decision
      FROM stack_runs r LEFT JOIN stack_run_results c ON c.run_id=r.id WHERE {scope}
    ) SELECT 'overview|'||json_build_object(
      'retainedCount',count(*),
      'states',json_build_object('queued',count(*) FILTER(WHERE state='queued'),'succeeded',count(*) FILTER(WHERE state='succeeded'),'failed',count(*) FILTER(WHERE state='failed')),
      'decisions',json_build_object('pass',count(*) FILTER(WHERE decision='pass'),'block',count(*) FILTER(WHERE decision='block'),'inconclusive',count(*) FILTER(WHERE decision='inconclusive')),
      'runsSha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),''),'UTF8')),'hex') FROM stack_runs r WHERE {scope})
    )::text FROM observations"""
    output = sql("BEGIN READ ONLY;SET LOCAL statement_timeout='2s';" + query + ';ROLLBACK;')
    lines = [line[len('overview|'):] for line in output.splitlines() if line.startswith('overview|')]
    if len(lines) != 1:
        raise ValueError('Incomplete comparison')
    value = json.loads(lines[0])
    counts = [value['retainedCount'], *value['states'].values(), *value['decisions'].values()]
    if any(type(count) is not int or not 0 <= count <= 100000 for count in counts) or not re.fullmatch('[a-f0-9]{64}', value['runsSha256']):
        raise ValueError('Unexpected aggregate')
    print(json.dumps(value))
except Exception:
    print(json.dumps({'completed': False, 'error': 'EVALUATION_DATABASE_COMPARISON_UNAVAILABLE'}))
    raise SystemExit(2)
