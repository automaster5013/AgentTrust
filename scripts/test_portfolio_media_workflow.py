"""Synthetic boundary tests; never capture desktop or access product services."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import portfolio_media_tools as tools


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capture = load('capture', 'portfolio-capture.py')
review = load('review', 'portfolio-media-review.py')


class WorkflowTests(unittest.TestCase):
    def admission(self):
        now = dt.datetime.now(dt.timezone.utc)
        start = now - dt.timedelta(seconds=910)
        data = {'completed': True, 'requiredPhysicalBytes': capture.MEMORY,
            'requiredDiskBytes': capture.DISK, 'requiredStableSeconds': 900,
            'samples': [{'at': (start + dt.timedelta(seconds=i * 10)).isoformat(),
                'qualifying': True, 'availablePhysicalBytes': capture.MEMORY,
                'freeDiskBytes': capture.DISK, 'stableSeconds': i * 10} for i in range(91)]}
        return data, now, start - dt.timedelta(hours=1)

    def test_continuous_admission(self):
        capture.validate_admission(*self.admission())

    def test_prior_boot_and_stale_admission(self):
        data, now, boot = self.admission()
        for test_now, test_boot in [(now + dt.timedelta(minutes=6), boot), (now, now - dt.timedelta(seconds=30))]:
            with self.assertRaises(ValueError):
                capture.validate_admission(data, test_now, test_boot)

    def test_false_completion_and_broken_samples(self):
        for mutation in ['completed', 'memory', 'disk', 'gap', 'missing']:
            data, now, boot = self.admission()
            if mutation == 'completed': data['completed'] = False
            if mutation == 'memory': data['samples'][10]['availablePhysicalBytes'] = 1
            if mutation == 'disk': data['samples'][10]['freeDiskBytes'] = 1
            if mutation == 'gap': data['samples'][10]['at'] = data['samples'][9]['at']
            if mutation == 'missing': data['samples'].pop(10)
            with self.assertRaises(ValueError):
                capture.validate_admission(data, now, boot)

    def test_capture_is_bounded_window_only_and_silent(self):
        command = capture.capture_command('ffmpeg', 123, 240, Path('fixture.mp4'))
        self.assertIn('hwnd=123', command)
        self.assertNotIn('desktop', command)
        self.assertIn('-an', command)
        self.assertIn('-n', command)
        for hwnd, seconds in [(0, 240), (1, 300), (1, 0)]:
            with self.assertRaises(ValueError):
                capture.capture_command('ffmpeg', hwnd, seconds, Path('fixture.mp4'))

    def test_prepare_does_not_admit_inspect_windows_or_record(self):
        with patch('sys.argv', ['capture']), patch.object(capture, 'find_tool', return_value='ffmpeg'), \
             patch.object(capture, 'recent_admission') as admission, patch.object(capture, 'runtime_guard') as guard, \
             patch.object(capture, 'target_window') as window, patch.object(capture.subprocess, 'Popen') as process, patch('builtins.print'):
            self.assertEqual(capture.main(), 0)
            admission.assert_not_called()
            guard.assert_not_called()
            window.assert_not_called()
            process.assert_not_called()

    def test_record_cannot_bypass_missing_admission(self):
        with patch('sys.argv', ['capture', '--record']), patch.object(capture, 'find_tool', return_value='ffmpeg'), \
             patch.object(capture.sys.stdin, 'isatty', return_value=True), \
             patch.object(capture, 'recent_admission', side_effect=ValueError('no-fresh-admission')), \
             patch.object(capture, 'runtime_guard') as guard, patch.object(capture.subprocess, 'Popen') as process:
            with self.assertRaises(ValueError):
                capture.main()
            guard.assert_not_called()
            process.assert_not_called()

    def test_sampling_covers_caption_midpoints(self):
        self.assertEqual(tools.sample_times(4, 2, [{'start': 1, 'end': 2}]), [0, 1.5, 2])
        for duration, interval in [(float('nan'), 2), (601, 10), (5, 0), (600, 1)]:
            with self.assertRaises(ValueError):
                tools.sample_times(duration, interval)

    def test_windows_powershell_ocr_has_no_encoding_ambiguity(self):
        # Windows PowerShell 5.1 reads BOM-less scripts using its ANSI code page.
        script = Path(__file__).with_name('portfolio-frame-ocr.ps1').read_bytes()
        self.assertTrue(script.isascii())

    def test_disk_guard_stops_before_extraction(self):
        with patch.object(tools.shutil, 'disk_usage') as disk, patch.object(tools.subprocess, 'run') as run:
            disk.return_value.free = 0
            with self.assertRaises(ValueError):
                tools.extract_frames(Path('fixture.mp4'), Path('must-not-create'), [0], 'ffmpeg')
            run.assert_not_called()

    def test_private_plan_hashes_and_no_recognized_text(self):
        parent = tools.ROOT / '.local/portfolio-media-synthetic-tests'
        parent.mkdir(exist_ok=True, parents=True)
        folder = Path(tempfile.mkdtemp(prefix='plan-synthetic-', dir=parent))
        report = {'videoSha256': 'fixture-video', 'captionsSha256': 'fixture-captions',
            'frames': [{'file': 'frames/frame-000.png', 'atSeconds': 1, 'sha256': 'fixture-frame',
                'ocr': {'wholeFrameKinds': ['email'], 'findings': [{'kind': 'email'}]}}],
            'captions': {'cues': [{'cue': 1, 'start': 0, 'end': 2}], 'findings': []}}
        review.write_review_plan(folder, report)
        decisions = json.loads((folder / 'review-decisions-template.json').read_text())
        self.assertFalse(decisions['accepted'])
        self.assertEqual(decisions['reviewPlanSha256'], tools.sha(folder / 'review-plan.tsv'))
        self.assertEqual(decisions['fullFootageVisualExposure'], 'not-reviewed')
        self.assertEqual(len(decisions['tasks']), 2)
        self.assertIn('email', (folder / 'review-plan.tsv').read_text())
        masking = json.loads((folder / 'masking-candidates.json').read_text())
        self.assertEqual(len(masking['candidates']), 1)
        self.assertFalse(masking['candidates'][0]['maskApplied'])
        self.assertFalse(masking['fullVideoReviewed'])


if __name__ == '__main__':
    unittest.main()
