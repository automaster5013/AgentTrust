"""Read-only disposable hosted receipt metadata comparison; never exports signed payloads."""
import json
import os
import re
import sys
import uuid
from stack_business_fingerprint import sql
try:
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('AGENTTRUST_AUDIT_V17_FIXTURE') != '1' or len(sys.argv) not in (3, 4):
        raise ValueError('Hosted fixture required')
    if any(str(uuid.UUID(value)) != value for value in sys.argv[1:]):
        raise ValueError('Invalid scope')
    organization, project = sys.argv[1:3]
    scope = f"organization_id='{organization}' AND project_id='{project}'"
    if len(sys.argv) == 4:
        scope += f" AND campaign_id='{sys.argv[3]}'"
    query = f"""WITH scoped AS (SELECT * FROM stack_campaign_receipts WHERE {scope}),
    metadata AS (SELECT id,campaign_id,key_id,created_at FROM scoped ORDER BY created_at DESC,id DESC LIMIT 25)
    SELECT 'receipts|'||json_build_object('count',(SELECT count(*) FROM scoped),
      'sha256',(SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM scoped t),
      'entries',(SELECT coalesce(json_agg(json_build_object('id',id,'campaignId',campaign_id,'keyId',key_id,'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY created_at DESC,id DESC),'[]'::json) FROM metadata))::text"""
    output = sql("BEGIN READ ONLY;SET LOCAL statement_timeout='2s';" + query + ';ROLLBACK;')
    lines = [line[len('receipts|'):] for line in output.splitlines() if line.startswith('receipts|')]
    if len(lines) != 1:
        raise ValueError('Incomplete comparison')
    value = json.loads(lines[0])
    if type(value['count']) is not int or not 0 <= value['count'] <= 100000 or len(value['entries']) > 25 or not re.fullmatch('[a-f0-9]{64}', value['sha256']):
        raise ValueError('Invalid comparison')
    print(json.dumps(value))
except Exception:
    print(json.dumps({'completed': False, 'error': 'RECEIPT_DATABASE_COMPARISON_UNAVAILABLE'}))
    raise SystemExit(2)
