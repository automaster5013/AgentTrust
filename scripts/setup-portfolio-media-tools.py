"""Install pinned local FFmpeg tools without PATH changes or system installation."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.local' / 'portfolio-media-tools'
URL = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.7z'
SHA256 = '4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077'
PREFIX = 'ffmpeg-9.0.2-essentials_build'
DISK_FLOOR = 23622320128 + 536870912


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    archive = DEST / (PREFIX + '.7z')
    if not archive.exists():
        if shutil.disk_usage(ROOT).free < DISK_FLOOR + 280 * 1024 * 1024:
            raise ValueError('disk-reserve')
        # Exclusive create preserves an interrupted archive for diagnosis, never retries.
        with urllib.request.urlopen(URL, timeout=30) as response, archive.open('xb') as output:
            total = 0
            while block := response.read(1048576):
                total += len(block)
                if total > 60 * 1024 * 1024:
                    raise ValueError('download-size-limit')
                output.write(block)
    if sha(archive) != SHA256:
        raise ValueError('archive-checksum')
    tools = {name: DEST / PREFIX / 'bin' / (name + '.exe') for name in ('ffmpeg', 'ffprobe')}
    if not all(path.is_file() for path in tools.values()):
        if (DEST / PREFIX).exists():
            raise ValueError('partial-extraction-preserved')
        subprocess.run(['tar.exe', '-xf', str(archive), '-C', str(DEST),
            PREFIX + '/bin/ffmpeg.exe', PREFIX + '/bin/ffprobe.exe', PREFIX + '/LICENSE'],
            capture_output=True, timeout=60, check=True)
        # Compact only the new local binaries, preserving bytes and existing assets.
        subprocess.run(['compact.exe', '/C', '/F', '/EXE:LZX', '/I',
            *[str(p) for p in tools.values()]], capture_output=True, timeout=60, check=True)
    versions = {}
    for name, path in tools.items():
        version = subprocess.run([str(path), '-version'], capture_output=True, timeout=10, check=True)
        versions[name] = {'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(path),
            'version': version.stdout.decode('utf-8', errors='replace').splitlines()[0]}
    manifest = {'source': URL, 'archiveSha256': SHA256, 'tools': versions, 'systemPathChanged': False}
    (DEST / 'tools.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('LOCAL_MEDIA_TOOLS_READY; pinned_archive_verified; no_system_changes')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        print('LOCAL_MEDIA_TOOLS_STOPPED; no_automatic_retry; partial_files_preserved')
        raise SystemExit(2)
