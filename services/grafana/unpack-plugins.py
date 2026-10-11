"""Preserve official signed plugin bytes while validating bounded archives."""
import hashlib
import json
import pathlib
import re
import stat
import zipfile


def unpack(lock_path=pathlib.Path('/packages/plugins.lock.json'), destination=pathlib.Path('/plugins')):
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    assert lock['schemaVersion'] == 1 and lock['grafanaVersion'] == '13.2.3'
    plugins = lock['plugins']
    assert len(plugins) == 13 and len({p['id'] for p in plugins}) == 13
    destination.mkdir(parents=True, exist_ok=False)
    for plugin in plugins:
        identity = plugin['id']
        assert re.fullmatch(r'[a-z][a-z0-9-]{1,63}', identity)
        archive = lock_path.parent / (identity + '.zip')
        assert 0 < archive.stat().st_size <= 64 * 1024 * 1024
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == plugin['sha256']
        with zipfile.ZipFile(archive) as bundle:
            entries = bundle.infolist()
            assert 0 < len(entries) <= 5000
            assert sum(e.file_size for e in entries) <= 128 * 1024 * 1024
            names = set()
            for entry in entries:
                path = pathlib.PurePosixPath(entry.filename)
                mode = entry.external_attr >> 16
                assert not path.is_absolute() and '\\' not in entry.filename
                assert path.parts and path.parts[0] == identity
                assert not any(p in ('..', '.', '') for p in path.parts)
                assert ':' not in entry.filename and '\x00' not in entry.filename
                assert entry.filename not in names
                names.add(entry.filename)
                assert not stat.S_ISLNK(mode) and not mode & (stat.S_ISUID | stat.S_ISGID)
                assert stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR)
                assert not entry.flag_bits & 1
                target = destination.joinpath(*path.parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(entry) as source, target.open('xb') as output:
                        remaining = entry.file_size
                        while remaining:
                            chunk = source.read(min(65536, remaining))
                            assert chunk
                            output.write(chunk)
                            remaining -= len(chunk)
                        assert not source.read(1)
                    target.chmod(0o755 if mode & 0o111 else 0o644)
        metadata = json.loads((destination / identity / 'plugin.json').read_text(encoding='utf-8'))
        assert metadata['id'] == identity and metadata['info']['version'] == plugin['version']
        assert (destination / identity / 'MANIFEST.txt').is_file()


if __name__ == '__main__':
    unpack()
