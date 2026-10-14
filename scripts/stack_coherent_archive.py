"""Fail-closed archive contracts for an isolated cold recovery rehearsal.

These checks authenticate structure, not provenance. Callers must authenticate the
encrypted manifest and match each component digest before validating/extracting it.
"""
import hashlib
import io
import pathlib
import re
import tarfile

COMPRESSED_LIMIT = 64 * 1024 * 1024 - 128
TOTAL_LIMIT = 512 * 1024 * 1024
FILE_LIMIT = 64 * 1024 * 1024
MEMBER_LIMIT = 50000
SERVICES = ('stack-db', 'stack-identity', 'stack-nats', 'stack-redis',
            'stack-object-store', 'stack-opa', 'stack-quality-verifier',
            'stack-ai-worker', 'stack-core-api', 'stack-gateway', 'stack-console')
STATEFUL = ('stack-db', 'stack-identity', 'stack-nats', 'stack-redis', 'stack-object-store')


def archive_fingerprints(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= COMPRESSED_LIMIT:
        raise ValueError('Cold archive size refused')
    files, seen, total = {}, set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r|gz') as archive:
        for member in archive:
            name = member.name
            path = pathlib.PurePosixPath(name)
            canonical = str(path)
            if (len(seen) >= MEMBER_LIMIT or not name or len(name) > 1024
                    or path.is_absolute() or '..' in path.parts
                    or '\\' in name or '\x00' in name or ':' in name
                    or canonical in seen):
                raise ValueError('Cold archive member path refused')
            if (member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE)
                    or member.mode & 0o6000 or member.isfile() and member.mode & 0o1000
                    or canonical == '.' and not member.isdir()):
                raise ValueError('Cold archive member type refused')
            seen.add(canonical)
            if not member.isfile():
                if member.size != 0:
                    raise ValueError('Cold archive directory payload refused')
                continue
            total += member.size
            if not 0 <= member.size <= FILE_LIMIT or total > TOTAL_LIMIT:
                raise ValueError('Cold archive expanded size refused')
            source = archive.extractfile(member)
            digest, count = hashlib.sha256(), 0
            while chunk := source.read(min(1024 * 1024, member.size - count + 1)):
                count += len(chunk)
                if count > member.size:
                    raise ValueError('Cold archive member overflow')
                digest.update(chunk)
            if count != member.size:
                raise ValueError('Cold archive member truncated')
            files[canonical] = {'bytes': count, 'sha256': digest.hexdigest(), 'mode': member.mode & 0o7777}
    if not seen:
        raise ValueError('Empty cold archive refused')
    return files


def validate_manifest(value, expected_id, expected_revision):
    if not isinstance(value, dict) or set(value) != {'schema', 'snapshotId', 'revision', 'services', 'components', 'quiescence'}:
        raise ValueError('Cold manifest frame refused')
    if (value['schema'] != 1 or value['snapshotId'] != expected_id
            or value['revision'] != expected_revision
            or not re.fullmatch('[a-f0-9]{40}', expected_revision)
            or not re.fullmatch('[a-f0-9-]{36}', expected_id)):
        raise ValueError('Cold manifest identity refused')
    if not isinstance(value['services'], dict) or set(value['services']) != set(SERVICES):
        raise ValueError('Cold manifest service set refused')
    for service, entry in value['services'].items():
        if (not isinstance(entry, dict) or set(entry) != {'imageId', 'containerId'}
                or not re.fullmatch('sha256:[a-f0-9]{64}', entry.get('imageId', ''))
                or not re.fullmatch('[a-f0-9]{64}', entry.get('containerId', ''))):
            raise ValueError('Cold manifest runtime binding refused')
    required = set(STATEFUL) | {'configuration'}
    if not isinstance(value['components'], dict) or set(value['components']) != required:
        raise ValueError('Cold manifest component set refused')
    for component in value['components'].values():
        if (not isinstance(component, dict) or set(component) != {'bytes', 'sha256'}
                or type(component['bytes']) is not int or not 0 < component['bytes'] <= 64 * 1024 * 1024
                or not isinstance(component['sha256'], str)
                or not re.fullmatch('[a-f0-9]{64}', component['sha256'])):
            raise ValueError('Cold manifest component binding refused')
    if value['quiescence'] != {'allWritersStopped': True, 'allStatefulServicesStopped': True, 'pendingEvaluations': 0}:
        raise ValueError('Cold manifest consistency point refused')
    # bool is an int subclass; reject it at all numeric contract boundaries.
    if (type(value['schema']) is not int or type(value['quiescence']['pendingEvaluations']) is not int
            or type(value['quiescence']['allWritersStopped']) is not bool
            or type(value['quiescence']['allStatefulServicesStopped']) is not bool):
        raise ValueError('Cold manifest scalar types refused')
    return value


def verify_component(raw, expected):
    if not isinstance(raw, bytes) or len(raw) != expected['bytes'] or hashlib.sha256(raw).hexdigest() != expected['sha256']:
        raise ValueError('Cold component binding mismatch')
    return raw
