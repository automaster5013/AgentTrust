"""Opt-in, window-only capture. Never starts admission, logs in, or changes services."""
import argparse
import ctypes
from ctypes import wintypes
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from portfolio_media_tools import ROOT, find_tool, sha

BASE = ROOT / '.local/portfolio-4310-focused-review-20261027'
GUARD = ROOT / '.local/portfolio_runtime_guard_20261027.py'
GUARD_HASH = 'ad3d5e055c4ed2e4c62634c4cd34c4d5af9bb1f7c399eb4f838d4c219ad72711'
MEMORY = 3758096384
DISK = 28301660260


def validate_admission(data, now, boot):
    if data.get('completed') is not True or data.get('requiredPhysicalBytes') != MEMORY or data.get('requiredDiskBytes') != DISK or data.get('requiredStableSeconds') != 900:
        raise ValueError('admission-incomplete')
    samples = data.get('samples', [])
    if len(samples) < 91 or len(samples) > 1000:
        raise ValueError('admission-samples')
    tail = []
    for sample in reversed(samples):
        if sample.get('qualifying') is not True or sample.get('availablePhysicalBytes', 0) < MEMORY or sample.get('freeDiskBytes', 0) < DISK:
            break
        tail.append(sample)
    tail.reverse()
    if len(tail) < 91 or tail[-1].get('stableSeconds', 0) < 900:
        raise ValueError('admission-not-continuous')
    dates = [dt.datetime.fromisoformat(s['at']) for s in tail]
    if not all(t.tzinfo for t in dates) or dates[0] < boot or not 0 <= (now - dates[-1]).total_seconds() <= 300:
        raise ValueError('admission-stale-or-prior-boot')
    if (dates[-1] - dates[0]).total_seconds() < 899 or any(not 0 < (b-a).total_seconds() <= 20 for a,b in zip(dates, dates[1:])):
        raise ValueError('admission-gaps')


def recent_admission():
    now = dt.datetime.now(dt.timezone.utc)
    uptime = ctypes.windll.kernel32.GetTickCount64
    uptime.restype = ctypes.c_ulonglong
    boot = now - dt.timedelta(milliseconds=uptime())
    for path in sorted(BASE.glob('offline-user-review-v2-*/admission.json'), key=lambda p: p.stat().st_mtime, reverse=True):
        if path.stat().st_size > 1024 * 1024:
            continue
        try:
            validate_admission(json.loads(path.read_text(encoding='utf-8')), now, boot)
            return
        except (ValueError, KeyError, TypeError):
            continue
    raise ValueError('fresh-existing-admission-required-no-auto-run')


def runtime_guard(budget):
    if sha(GUARD) != GUARD_HASH:
        raise ValueError('guard-integrity')
    spec = importlib.util.spec_from_file_location('preserved_capture_guard', GUARD)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    # Existing guard stays intact; stricter capture memory/disk thresholds are supplied.
    guard.require(budget, extra_physical_bytes=1610612736, extra_disk_bytes=4679340132)
    result = subprocess.run(['docker', 'ps', '-q'], capture_output=True, text=True, timeout=10, check=True)
    ids = result.stdout.split()
    if len(ids) != 20:
        raise ValueError('services-count')
    containers = json.loads(subprocess.run(['docker', 'inspect', *ids], capture_output=True, timeout=10, check=True).stdout)
    if not all(c['Name'].startswith('/agenttrust-') and c['State'].get('Health', {}).get('Status') == 'healthy' for c in containers):
        raise ValueError('services-not-healthy')


def window_title(hwnd):
    user = ctypes.windll.user32
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    text = ctypes.create_unicode_buffer(512)
    user.GetWindowTextW(hwnd, text, 512)
    return text.value


def target_window():
    user = ctypes.windll.user32
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsIconic.argtypes = [wintypes.HWND]
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    windows = []
    def visit(hwnd, _):
        if user.IsWindowVisible(hwnd) and window_title(hwnd).startswith('AgentTrust · Release gates'):
            windows.append(hwnd)
        return True
    user.EnumWindows(callback_type(visit), 0)
    if len(windows) != 1:
        raise ValueError('exactly-one-product-window-required')
    return windows[0]


def capture_command(binary, hwnd, seconds, output):
    if not isinstance(hwnd, int) or hwnd <= 0 or not 30 <= seconds <= 240:
        raise ValueError('invalid-capture-bounds')
    return [binary, '-hide_banner', '-loglevel', 'error', '-n', '-f', 'gdigrab',
        '-framerate', '12', '-draw_mouse', '1', '-i', f'hwnd={hwnd}', '-t', str(seconds),
        '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-threads', '1',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p',
        '-movflags', '+frag_keyframe+empty_moov', str(output)]


def append(path, event):
    with path.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'atUtc': dt.datetime.now(dt.timezone.utc).isoformat(), **event}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', action='store_true', help='Explicitly enable capture after existing admission and login confirmation')
    parser.add_argument('--seconds', type=int, default=240, choices=range(30, 241), metavar='30..240')
    args = parser.parse_args()
    binary = find_tool('ffmpeg')
    if not binary:
        raise ValueError('ffmpeg-unavailable')
    if not args.record:
        print('PREPARED_ONLY; capture_not_started; requires_fresh_existing_admission_and_signed_in_4310')
        return 0
    if os.name != 'nt' or not sys.stdin.isatty():
        raise ValueError('interactive-windows-console-required')
    recent_admission()
    runtime_guard(args.seconds + 60)
    print('4310에 로그인한 뒤 기존 조회 화면을 준비하세요. 로그인·키 입력을 촬영하지 않습니다.', flush=True)
    input('준비되면 Enter: 녹화 시작 / Ctrl+C: 취소. 최대 4분 후 자동 종료됩니다. ')
    # Login time must not make old admission silently reusable.
    recent_admission()
    runtime_guard(args.seconds + 60)
    hwnd = target_window()
    inbox = BASE / 'video-inbox'
    inbox.mkdir(exist_ok=True)
    token = uuid.uuid4().hex
    output = inbox / ('4310-unreviewed-' + token + '.mp4')
    journal = inbox / ('capture-' + token + '.jsonl')
    append(journal, {'event': 'capture-start-requested', 'accepted': False, 'source': 'signed-in-window-user-confirmed', 'audioCaptured': False})
    process = None
    reason = 'capture-ended'
    try:
        process = subprocess.Popen(capture_command(binary, hwnd, args.seconds, output), stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print('녹화 중: 4분 후 자동 종료 / 이 콘솔에서 Enter를 누르면 조기 종료. 창·탭을 바꾸지 마세요.', flush=True)
        import msvcrt
        checked = time.monotonic()
        deadline = checked + args.seconds + 15
        while process.poll() is None:
            if not window_title(hwnd).startswith('AgentTrust · Release gates') or ctypes.windll.user32.IsIconic(hwnd):
                raise ValueError('product-window-changed-or-minimized')
            if time.monotonic() > deadline:
                raise ValueError('capture-timeout')
            if time.monotonic() - checked >= 5:
                runtime_guard(60)
                checked = time.monotonic()
            if msvcrt.kbhit() and msvcrt.getwch() == '\r':
                reason = 'user-stopped'
                break
            time.sleep(0.25)
    except BaseException:
        reason = 'capture-interrupted-or-blocked'
        raise
    finally:
        if process is not None and process.poll() is None:
            try:
                process.communicate(b'q\n', timeout=8)
            except (OSError, subprocess.TimeoutExpired):
                process.terminate()  # Only this tool's owned encoder process.
                process.wait(timeout=8)
        append(journal, {'event': reason, 'encoderExitCode': process.returncode if process else None,
            'fileExists': output.is_file(), 'accepted': False, 'packageComplete': False})
    if process.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        raise ValueError('capture-not-produced')
    print('PRIVATE_VIDEO_SAVED_UNREVIEWED; file=' + output.name)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (AssertionError, ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, KeyboardInterrupt):
        print('CAPTURE_STOPPED; no_auto_retry; evidence_preserved; no_media_approval')
        raise SystemExit(2)
