"""Bounded read-only PostgreSQL business fingerprints, without exporting row contents."""
import pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parent.parent
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

