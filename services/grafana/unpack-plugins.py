"""Preserve official signed plugin bytes while validating bounded archives."""
import hashlib
import json
import pathlib
import re
import stat
import zipfile


def unpack(lock_path=pathlib.Path('/packages/plugins.lock.json'), destination=pathlib.Path('/plugins')):
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    if not (lock['schemaVersion'] == 1 and lock['grafanaVersion'] == '13.2.3'):
        raise ValueError("Invalid official plugin archive")
    plugins = lock['plugins']
    if not (len(plugins) == 13 and len({p['id'] for p in plugins}) == 13):
        raise ValueError("Invalid official plugin archive")
    destination.mkdir(parents=True, exist_ok=False)
    for plugin in plugins:
        identity = plugin['id']
        if not (re.fullmatch(r'[a-z][a-z0-9-]{1,63}', identity)):
            raise ValueError("Invalid official plugin archive")
        archive = lock_path.parent / (identity + '.zip')
        if not (0 < archive.stat().st_size <= 64 * 1024 * 1024):
            raise ValueError("Invalid official plugin archive")
        if not (hashlib.sha256(archive.read_bytes()).hexdigest() == plugin['sha256']):
            raise ValueError("Invalid official plugin archive")
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            if not (0 < len(entries) <= 5000):
                raise ValueError("Invalid official plugin archive")
            if not (sum(e.file_size for e in entries) <= 128 * 1024 * 1024):
                raise ValueError("Invalid official plugin archive")
            names = set()
            for entry in entries:
                if entry.orig_filename != entry.filename:
                    raise ValueError("Invalid official plugin archive")
                path = pathlib.PurePosixPath(entry.filename)
                mode = entry.external_attr >> 16
                if not (not path.is_absolute() and '\\' not in entry.filename):
                    raise ValueError("Invalid official plugin archive")
                if not (path.parts and path.parts[0] == identity):
                    raise ValueError("Invalid official plugin archive")
                if not (not any(p in ('..', '.', '') for p in path.parts)):
                    raise ValueError("Invalid official plugin archive")
                if not (':' not in entry.filename and '\x00' not in entry.filename):
                    raise ValueError("Invalid official plugin archive")
                if not (entry.filename not in names):
                    raise ValueError("Invalid official plugin archive")
                names.add(entry.filename)
                if not (not stat.S_ISLNK(mode) and not mode & (stat.S_ISUID | stat.S_ISGID)):
                    raise ValueError("Invalid official plugin archive")
                if not (stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError("Invalid official plugin archive")
                if not (not entry.flag_bits & 1):
                    raise ValueError("Invalid official plugin archive")
                target = destination.joinpath(*path.parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(entry) as source, target.open('xb') as output:
                        remaining = entry.file_size
                        while remaining:
                            chunk = source.read(min(65536, remaining))
                            if not (chunk):
                                raise ValueError("Invalid official plugin archive")
                            output.write(chunk)
                            remaining -= len(chunk)
                        if not (not source.read(1)):
                            raise ValueError("Invalid official plugin archive")
                    target.chmod(0o755 if mode & 0o111 else 0o644)
        metadata = json.loads((destination / identity / 'plugin.json').read_text(encoding='utf-8'))
        if not (metadata['id'] == identity and metadata['info']['version'] == plugin['version']):
            raise ValueError("Invalid official plugin archive")
        if not ((destination / identity / 'MANIFEST.txt').is_file()):
            raise ValueError("Invalid official plugin archive")


if __name__ == '__main__':
    unpack()
