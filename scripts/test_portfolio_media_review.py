import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).parent))

spec = importlib.util.spec_from_file_location('media', Path(__file__).with_name('portfolio-media-review.py'))
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaReviewTests(unittest.TestCase):
    def cue(self, timing='00:00:01,000 --> 00:00:04,000', body='기존 실행 결과를 조회합니다.'):
        return '1\n' + timing + '\n' + body + '\n'

    def test_valid_korean_caption(self):
        self.assertEqual(media.audit_captions(self.cue(), 5)['findings'], [])

    def test_timestamp_and_duration(self):
        for timing in ['00:60:01,000 --> 00:61:04,000', '00:00:04,000 --> 00:00:01,000', '00:00:01,000 --> 00:00:09,000']:
            self.assertTrue(media.audit_captions(self.cue(timing), 5)['findings'])

    def test_overlap(self):
        text = self.cue() + '\n2\n00:00:03,000 --> 00:00:05,000\n조회\n'
        self.assertIn('overlap-or-invalid-order', [x['kind'] for x in media.audit_captions(text, 6)['findings']])

    def test_sensitive_content_never_returned(self):
        secret = 'password=synthetic-fixture-only'
        result = media.audit_captions(self.cue(body=secret), 5)
        self.assertIn('credential-assignment', json.dumps(result))
        self.assertNotIn(secret, json.dumps(result))

    def test_empty_and_invalid_structure(self):
        for text in ['', '1\nbad\ncaption', '2\n00:00:01,000 --> 00:00:04,000\ncaption']:
            self.assertTrue(media.audit_captions(text, 5)['findings'])

    def test_missing_duration_is_not_invented(self):
        self.assertEqual(media.audit_captions(self.cue(), None)['cues'][0]['end'], 4)

    def test_probe_rejects_nonvideo_and_nonfinite(self):
        for data in [{'format': {'duration': 'nan'}, 'streams': [{'codec_type': 'video'}]}, {'format': {'duration': '4'}, 'streams': [{'codec_type': 'audio'}]}]:
            with patch.object(media.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(data).encode(), b'')):
                with self.assertRaises(ValueError):
                    media.probe(Path('synthetic.mp4'), 'ffprobe')

    def test_probe_is_local_and_bounded(self):
        data = {'format': {'duration': '4'}, 'streams': [{'codec_type': 'video'}]}
        with patch.object(media.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(data).encode(), b'')) as run:
            self.assertEqual(media.probe(Path('synthetic.mp4'), 'ffprobe'), (4, False))
            self.assertEqual(run.call_args.kwargs['timeout'], 30)
            self.assertIn('file', run.call_args.args[0])

    def test_draft_requires_observed_source_and_exact_video_hash(self):
        for timeline in [{}, {'videoSha256': 'different', 'source': 'observed-video-timeline'}, {'videoSha256': 'fixture', 'source': 'synthetic'}]:
            with self.assertRaises(ValueError):
                media.draft_captions(timeline, 'fixture')

    def test_draft_preserves_observed_text_and_timing(self):
        timeline = {'videoSha256': 'fixture', 'source': 'observed-video-timeline', 'cues': [{'start': 1.25, 'end': 4.5, 'text': '기존 실행 조회'}]}
        draft = media.draft_captions(timeline, 'fixture')
        self.assertIn('00:00:01,250 --> 00:00:04,500', draft)
        self.assertEqual(media.audit_captions(draft, 5)['findings'], [])

    def test_draft_rejects_nonfinite_and_subtitle_injection(self):
        for entry in [{'start': float('nan'), 'end': 4, 'text': '조회'}, {'start': 1, 'end': 4, 'text': '조회\n\n2\n내용'}]:
            with self.assertRaises(ValueError):
                media.draft_captions({'videoSha256': 'fixture', 'source': 'observed-video-timeline', 'cues': [entry]}, 'fixture')

    def run_fixture(self, secret=False, probe_available=False):
        parent = media.ROOT / '.local' / 'portfolio-media-synthetic-tests'
        parent.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix='synthetic-', dir=parent))
        video = folder / 'synthetic-not-real-video.mp4'
        video.write_bytes(b'SYNTHETIC TEST FIXTURE; NOT ACTUAL VIDEO')
        timeline = folder / 'synthetic-timeline.json'
        timeline.write_text(json.dumps({'videoSha256': media.digest(video), 'source': 'observed-video-timeline',
            'cues': [{'start': 1, 'end': 4, 'text': 'password=synthetic-only' if secret else '테스트 자막'}]}), encoding='utf-8')
        with patch('sys.argv', ['review', '--video', str(video), '--timeline', str(timeline)]), \
             patch.object(media, 'find_tool', return_value='mock-ffprobe' if probe_available else None), \
             patch.object(media, 'probe', return_value=(5.0, False)), \
             patch.object(media, 'PRIVATE', folder / 'reports'), patch('builtins.print'):
            code = media.main()
        report_path = next((folder / 'reports').glob('*/review.json'))
        return code, json.loads(report_path.read_text()), report_path.parent

    def test_missing_probe_remains_blocked(self):
        code, report, folder = self.run_fixture()
        self.assertEqual(code, 2)
        self.assertFalse(report['accepted'])
        self.assertIn('ffprobe-unavailable', report['blockers'])
        self.assertNotIn('durationSeconds', report)

    def test_secret_draft_is_not_written_or_leaked(self):
        _, report, folder = self.run_fixture(secret=True)
        self.assertFalse((folder / 'captions-unapproved.srt').exists())
        self.assertNotIn('password=synthetic-only', json.dumps(report))

    def test_successful_technical_probe_does_not_approve_media(self):
        _, report, folder = self.run_fixture(probe_available=True)
        self.assertFalse(report['accepted'])
        self.assertFalse(report['packageComplete'])
        self.assertEqual(report['visualExposureReview'], 'not-reviewed')
        self.assertIn('caption-alignment-review-required', report['blockers'])
        self.assertTrue((folder / 'captions-unapproved.srt').is_file())


if __name__ == '__main__':
    unittest.main()
