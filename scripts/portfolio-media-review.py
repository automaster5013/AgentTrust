"""Offline media preflight. Does not capture, upload, transcribe or approve footage."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
from portfolio_media_tools import find_tool, sample_times, extract_frames, ocr_frames

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.local' / 'portfolio-media-review'
STAMP = r'(\d{2,}):(\d{2}):(\d{2}),(\d{3})'
TIME = re.compile(r'^' + STAMP + r' --> ' + STAMP + r'$')
PATTERNS = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'credential-assignment': re.compile(r'(?i)(?:\b(?:password|token|access_token|api[_-]?key|client_secret|secret)|비밀번호|접근키)\s*[:=]\s*\S+'),
    'bearer-token': re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}'),
    'provider-token': re.compile(r'\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})\b'),
    'email': re.compile(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b'),
    'uuid-record-id': re.compile(r'(?i)\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b'),
}


def seconds(parts):
    h, m, s, ms = map(int, parts)
    if m > 59 or s > 59:
        raise ValueError('invalid-time')
    return h * 3600 + m * 60 + s + ms / 1000


def audit_captions(text, duration):
    findings, cues = [], []
    previous = 0.0
    blocks = re.split(r'\n\s*\n', text.lstrip('\ufeff').replace('\r\n', '\n').strip())
    for number, block in enumerate(blocks, 1):
        lines = block.splitlines()
        def issue(kind):
            findings.append({'cue': number, 'kind': kind})
        if len(lines) < 3 or lines[0] != str(number):
            issue('invalid-cue-structure')
            continue
        match = TIME.fullmatch(lines[1])
        if not match:
            issue('invalid-timestamp')
            continue
        try:
            start, end = seconds(match.groups()[:4]), seconds(match.groups()[4:])
        except ValueError:
            issue('invalid-timestamp')
            continue
        if end <= start or start < previous:
            issue('overlap-or-invalid-order')
        if duration is not None and end > duration + 0.05:
            issue('beyond-video-duration')
        body = '\n'.join(lines[2:])
        for kind, pattern in PATTERNS.items():
            if pattern.search(body):
                issue(kind)
        if end > start and len(body.replace('\n', '')) / (end - start) > 20:
            issue('reading-speed-review')
        if len(lines[2:]) > 2 or any(len(line) > 42 for line in lines[2:]):
            issue('caption-layout-review')
        cues.append({'cue': number, 'start': start, 'end': end})
        previous = end
    return {'cues': cues, 'findings': findings}


def local_file(value, extensions):
    path = Path(value).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file() or path.suffix.lower() not in extensions:
        raise ValueError('invalid-local-input')
    return path


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def render_timestamp(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('invalid-timeline-time')
    total = round(value * 1000)
    hours, total = divmod(total, 3600000)
    minutes, total = divmod(total, 60000)
    sec, ms = divmod(total, 1000)
    return f'{hours:02}:{minutes:02}:{sec:02},{ms:03}'


def draft_captions(timeline, video_hash):
    # Require a binding to the exact source file; never reuse a synthetic script.
    if timeline.get('videoSha256') != video_hash or timeline.get('source') != 'observed-video-timeline':
        raise ValueError('unbound-or-unobserved-timeline')
    entries = timeline.get('cues')
    if not isinstance(entries, list) or not entries or len(entries) > 1000:
        raise ValueError('invalid-timeline-cues')
    blocks = []
    for number, entry in enumerate(entries, 1):
        text = entry['text']
        if not isinstance(text, str) or not text.strip() or len(text) > 500 or '\n\n' in text or '\r' in text:
            raise ValueError('invalid-timeline-caption')
        blocks.append(f'{number}\n{render_timestamp(entry["start"])} --> {render_timestamp(entry["end"])}\n{text.strip()}')
    return '\n\n'.join(blocks) + '\n'


def probe(video, binary):
    result = subprocess.run([binary, '-v', 'error', '-protocol_whitelist', 'file',
        '-show_entries', 'format=duration:stream=codec_type,width,height',
        '-of', 'json', str(video)], capture_output=True, timeout=30, check=True)
    data = json.loads(result.stdout)
    duration = float(data['format']['duration'])
    streams = data.get('streams', [])
    if not math.isfinite(duration) or duration <= 0 or not any(s.get('codec_type') == 'video' for s in streams):
        raise ValueError('invalid-video')
    return duration, any(s.get('codec_type') == 'audio' for s in streams)


def write_review_plan(folder, report):
    """Bind private manual review tasks to source hashes; no caption or OCR text."""
    rows = ['kind\titem\tstartSeconds\tendSeconds\tframe\tpatternKinds\tstatus']
    tasks, masking = [], []
    for frame in report.get('frames', []):
        kinds = sorted(set(frame.get('ocr', {}).get('wholeFrameKinds', [])) |
            {f['kind'] for f in frame.get('ocr', {}).get('findings', [])})
        item = frame['file']
        rows.append(f'frame\t{item}\t{frame["atSeconds"]}\t{frame["atSeconds"]}\t{item}\t{",".join(kinds)}\tnot-reviewed')
        tasks.append({'kind': 'frame', 'item': item, 'frameSha256': frame['sha256'], 'result': 'not-reviewed'})
        if kinds:
            masking.append({'sampleAtSeconds': frame['atSeconds'], 'frame': item,
                'patternKinds': kinds, 'boxes': [f.get('lineBoxes', []) for f in frame.get('ocr', {}).get('findings', [])],
                'action': 'inspect-original-to-determine-full-time-range-and-mask',
                'timeRangeVerified': False, 'maskApplied': False})
    frames = report.get('frames', [])
    for cue in report.get('captions', {}).get('cues', []):
        at = (cue['start'] + cue['end']) / 2
        nearest = min(frames, key=lambda f: abs(f['atSeconds'] - at))['file'] if frames else ''
        kinds = sorted({f['kind'] for f in report['captions']['findings'] if f['cue'] == cue['cue']})
        rows.append(f'caption\t{cue["cue"]}\t{cue["start"]}\t{cue["end"]}\t{nearest}\t{",".join(kinds)}\tnot-reviewed')
        tasks.append({'kind': 'caption-alignment', 'item': cue['cue'], 'result': 'not-reviewed'})
    plan = folder / 'review-plan.tsv'
    plan.write_text('\n'.join(rows) + '\n', encoding='utf-8')
    template = {'videoSha256': report['videoSha256'], 'captionsSha256': report.get('captionsSha256'),
        'reviewPlanSha256': digest(plan), 'accepted': False, 'packageComplete': False,
        'fullFootageVisualExposure': 'not-reviewed', 'fullAudioExposure': 'not-reviewed',
        'actual4310Provenance': 'unverified', 'tasks': tasks,
        'instructions': 'Inspect original footage and audio end to end. Samples miss short exposures. Review captions against actual content. Do not include raw secrets in notes. This template is not approval.'}
    (folder / 'review-decisions-template.json').write_text(json.dumps(template, indent=2) + '\n', encoding='utf-8')
    (folder / 'masking-candidates.json').write_text(json.dumps({'videoSha256': report['videoSha256'],
        'fullVideoReviewed': False, 'candidates': masking}, indent=2) + '\n', encoding='utf-8')
    report['reviewPlanSha256'] = template['reviewPlanSha256']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--captions', help='Existing UTF-8 SRT to audit')
    group.add_argument('--timeline', help='Observed JSON: source=observed-video-timeline, videoSha256, cues=[{start,end,text}]. Produces an unapproved SRT draft.')
    parser.add_argument('--frames', action='store_true', help='Extract private sampled frames; never constitutes full footage review')
    parser.add_argument('--ocr', action='store_true', help='Also run local Windows OCR on sampled frames; reports patterns only')
    parser.add_argument('--sample-interval', type=float, default=10, help='Seconds between samples (1..60), max 80 samples / 10 minute input')
    args = parser.parse_args()
    report = {'schemaVersion': 1, 'accepted': False, 'packageComplete': False,
        'actual4310Provenance': 'unverified', 'visualExposureReview': 'not-reviewed',
        'audioExposureReview': 'not-reviewed', 'captionContentAlignment': 'not-reviewed',
        'blockers': [], 'limitations': 'Caption patterns and optional sampled-frame OCR are incomplete. No speech recognition or automatic safety approval. Full footage and audio review remain required.'}
    video = local_file(args.video, {'.mp4', '.mkv', '.webm', '.mov'})
    report['videoSha256'] = digest(video)
    report['videoBytes'] = video.stat().st_size
    duration = None
    binary = find_tool('ffprobe')
    if binary:
        try:
            duration, audio = probe(video, binary)
            report.update(durationSeconds=duration, audioPresent=audio)
        except (ValueError, KeyError, subprocess.SubprocessError, OSError):
            report['blockers'].append('video-probe-failed')
    else:
        report['blockers'].append('ffprobe-unavailable')
    draft = None
    if args.timeline:
        timeline = local_file(args.timeline, {'.json'})
        if timeline.stat().st_size > 1024 * 1024:
            raise ValueError('timeline-too-large')
        draft = draft_captions(json.loads(timeline.read_text(encoding='utf-8')), report['videoSha256'])
        report['captions'] = audit_captions(draft, duration)
        # Never write suspected sensitive text into a generated SRT.
        if report['captions']['findings']:
            draft = None
            report['blockers'].append('draft-rejected-caption-findings')
        else:
            report['captionDraft'] = 'unapproved'
    elif args.captions:
        captions = local_file(args.captions, {'.srt'})
        if captions.stat().st_size > 1024 * 1024:
            raise ValueError('captions-too-large')
        report['captionsSha256'] = digest(captions)
        report['captions'] = audit_captions(captions.read_text(encoding='utf-8'), duration)
        if report['captions']['findings']:
            report['blockers'].append('caption-findings')
    else:
        report['blockers'].append('captions-missing')
    report['blockers'] += ['actual-product-provenance-review-required', 'visual-and-audio-review-required', 'caption-alignment-review-required']
    # Unique private output; never overwrite evidence or copy footage into public files.
    import uuid
    folder = PRIVATE / uuid.uuid4().hex
    folder.mkdir(parents=True, exist_ok=False)
    if args.frames or args.ocr:
        ffmpeg = find_tool('ffmpeg')
        if duration is None or not ffmpeg:
            report['blockers'].append('frame-extraction-unavailable')
        else:
            try:
                times = sample_times(duration, args.sample_interval, report.get('captions', {}).get('cues', []))
                report['frames'] = extract_frames(video, folder / 'frames', times, ffmpeg)
                report['sampleCoverage'] = {'intervalSeconds': args.sample_interval, 'fullVideoReviewed': False}
                if args.ocr:
                    report['frames'] = ocr_frames(folder, report['frames'])
                    report['ocrStatus'] = 'samples-scanned-not-full-video'
                    if any(f['ocr']['findings'] or f['ocr']['wholeFrameKinds'] for f in report['frames']):
                        report['blockers'].append('sampled-frame-exposure-findings')
            except (ValueError, KeyError, OSError, subprocess.SubprocessError):
                report['blockers'].append('frame-or-ocr-processing-incomplete')
    if draft is not None:
        draft_path = folder / 'captions-unapproved.srt'
        draft_path.write_text(draft, encoding='utf-8')
        report['captionsSha256'] = digest(draft_path)
    if digest(video) != report['videoSha256']:
        report['blockers'].append('source-video-changed-during-review')
    write_review_plan(folder, report)
    (folder / 'review.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('PRIVATE_REVIEW_WRITTEN; NOT_ACCEPTED; blockers=' + str(len(report['blockers'])) + '; directory=' + folder.relative_to(ROOT).as_posix())
    return 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, TypeError, AttributeError, OSError, UnicodeError):
        print('MEDIA_REVIEW_STOPPED; no input content or error details printed')
        raise SystemExit(2)
