"""Bounded offline helpers shared by portfolio media tools."""
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DISK_FLOOR = 23622320128 + 536870912


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def find_tool(name):
    if name not in {'ffmpeg', 'ffprobe'}:
        raise ValueError('unsupported-tool')
    manifest = ROOT / '.local/portfolio-media-tools/tools.json'
    if manifest.is_file():
        entry = json.loads(manifest.read_text(encoding='utf-8'))['tools'][name]
        path = (ROOT / entry['path']).resolve()
        if not path.is_relative_to(ROOT / '.local/portfolio-media-tools') or sha(path) != entry['sha256']:
            raise ValueError('local-tool-integrity')
        return str(path)
    return shutil.which(name)


def sample_times(duration, interval, cues=()):
    if not math.isfinite(duration) or not 0 < duration <= 600 or not 1 <= interval <= 60:
        raise ValueError('sampling-budget')
    times = {round(i * interval, 3) for i in range(math.ceil(duration / interval))}
    for cue in cues:
        start, end = cue['start'], cue['end']
        if not 0 <= start < end <= duration + 0.05:
            raise ValueError('invalid-caption-range')
        times.add(round(min((start + end) / 2, max(0, duration - 0.05)), 3))
    if len(times) > 80:
        raise ValueError('too-many-samples-use-larger-interval')
    return sorted(times)


def extract_frames(video, folder, times, binary):
    if shutil.disk_usage(ROOT).free < DISK_FLOOR + 32 * 1024 * 1024:
        raise ValueError('disk-reserve')
    folder.mkdir(exist_ok=False)
    frames = []
    for index, at in enumerate(times):
        if shutil.disk_usage(ROOT).free < DISK_FLOOR + 4 * 1024 * 1024:
            raise ValueError('disk-reserve')
        image = folder / f'frame-{index:03}.png'
        subprocess.run([binary, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
            '-protocol_whitelist', 'file', '-threads', '1', '-ss', str(at), '-i', str(video),
            '-map', '0:v:0', '-an', '-frames:v', '1', '-vf', 'scale=min(1920\\,iw):-2',
            '-threads', '1', str(image)], capture_output=True, timeout=15, check=True)
        if not image.is_file() or image.stat().st_size == 0:
            raise ValueError('frame-not-produced')
        frames.append({'atSeconds': at, 'file': 'frames/' + image.name, 'sha256': sha(image)})
    return frames


def ocr_frames(folder, frames):
    script = ROOT / 'scripts/portfolio-frame-ocr.ps1'
    # The Windows engine runs locally. Its output contains categories/boxes, never OCR text.
    for frame in frames:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', str(script), '-InputImage', str(folder / frame['file'])],
            capture_output=True, timeout=30, check=True)
        data = json.loads(result.stdout.decode('utf-8-sig'))
        if data.get('status') != 'sample-scanned':
            raise ValueError('ocr-unavailable')
        frame['ocr'] = data
    return frames
