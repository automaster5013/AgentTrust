"""Exercise the actual aggregation SQL in session-local PostgreSQL tables only."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
source = (root / 'services/core-api/src/main/java/dev/agenttrust/core/ProviderUsageReader.java').read_text(encoding='utf-8')
query = source.split('"""')[1].strip()
org = '00000000-0000-4000-8000-000000000001'
project = '00000000-0000-4000-8000-000000000002'
foreign = '00000000-0000-4000-8000-000000000003'
for value in [org, project, '2026-10-11']:
    query = query.replace('?', "'" + value + "'", 1)
assert '?' not in query
select = 'SELECT json_agg(row_to_json(usage)) FROM (' + query + ') usage;'
sql = '''BEGIN;
CREATE TEMP TABLE stack_provider_attempts(run_id uuid PRIMARY KEY,organization_id uuid,project_id uuid,budget_day date,provider text) ON COMMIT DROP;
CREATE TEMP TABLE stack_run_results(run_id uuid PRIMARY KEY,state text) ON COMMIT DROP;
''' + select
rows = [(1, org, project, '2026-10-11', 'ollama'),
        (2, org, project, '2026-10-11', 'ollama'),
        (3, org, project, '2026-10-11', 'ollama'),
        (4, org, project, '2026-10-11', 'openai-compatible'),
        (5, org, project, '2026-10-11', 'openai-compatible'),
        (6, foreign, project, '2026-10-11', 'ollama'),
        (7, org, foreign, '2026-10-11', 'ollama'),
        (8, org, project, '2026-10-10', 'ollama')]
run = lambda value: '10000000-0000-4000-8000-' + f'{value:012d}'
for number, organization, project_id, day, provider in rows:
    sql += "INSERT INTO stack_provider_attempts VALUES ('%s','%s','%s','%s','%s');\n" % (run(number), organization, project_id, day, provider)
for number, state in [(1, 'succeeded'), (2, 'failed'), (4, 'succeeded'), (5, 'failed')]:
    sql += "INSERT INTO stack_run_results VALUES ('%s','%s');\n" % (run(number), state)
sql += select + 'ROLLBACK;'
result = subprocess.run(['docker', 'exec', '-i', 'agenttrust-stack-db-1', 'psql', '-U', 'agenttrust_stack', '-d', 'agenttrust_stack', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True, encoding='utf-8', cwd=root, timeout=20, check=True)
empty, populated = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
names = ['ollama', 'openai', 'openai-compatible']
assert [row['provider'] for row in empty] == names
assert all([row[key] for key in ['reserved', 'succeeded', 'failed', 'pending']] == [0, 0, 0, 0] for row in empty)
assert [row['provider'] for row in populated] == names
assert [[row[key] for key in ['reserved', 'succeeded', 'failed', 'pending']] for row in populated] == [[3, 1, 1, 1], [0, 0, 0, 0], [2, 1, 1, 0]]
print(json.dumps({'completed': True, 'checks': 2, 'actualAggregationSql': True, 'businessWrites': False, 'temporaryTablesRolledBack': True, 'rlsVerifiedByThisTest': False}))
