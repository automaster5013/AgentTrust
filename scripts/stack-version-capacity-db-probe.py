"""Read-only count/fingerprint comparison for the owned hosted candidate browser fixture."""
import json
import os
import sys
import uuid
from stack_business_fingerprint import sql

try:
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('AGENTTRUST_AUDIT_V17_FIXTURE') != '1' or len(sys.argv) != 3:
        raise ValueError('Hosted fixture required')
    organization, project = sys.argv[1:]
    if any(str(uuid.UUID(value)) != value for value in (organization, project)):
        raise ValueError('Invalid scope')
    queries = []
    for kind, table in [('agents', 'stack_agent_versions'), ('datasets', 'stack_dataset_versions')]:
        queries.append(f"SELECT '{kind}'||'|'||count(*)::text||'|'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM {table} t WHERE organization_id='{organization}' AND project_id='{project}'")
    output = sql("BEGIN READ ONLY;SET LOCAL statement_timeout='2s';" + ' UNION ALL '.join(queries) + ';ROLLBACK;')
    result = {}
    for line in output.splitlines():
        if line.startswith(('agents|', 'datasets|')):
            kind, count, digest = line.split('|')
            if not count.isdecimal() or len(digest) != 64 or int(count) > 100000:
                raise ValueError('Unexpected count')
            result[kind] = {'used': int(count), 'sha256': digest}
    if set(result) != {'agents', 'datasets'}:
        raise ValueError('Incomplete comparison')
    print(json.dumps(result))
except Exception:
    print(json.dumps({'completed': False, 'error': 'CAPACITY_DATABASE_COMPARISON_UNAVAILABLE'}))
    raise SystemExit(2)
