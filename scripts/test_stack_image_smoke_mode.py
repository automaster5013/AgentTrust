"""Check the image smoke test mode without accessing Docker."""
from pathlib import Path
import subprocess
import sys
import unittest


class ImageSmokeModeTest(unittest.TestCase):
    def test_image_test_refuses_before_importing_release_profile(self):
        script = Path(__file__).with_name('stack-image-smoke.py')
        # Isolated mode excludes adjacent modules, so even a regression stops before setup.
        result = subprocess.run([sys.executable, '-I', '-S', '-O', str(script)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr.strip(),
                         'Image smoke test requires Python assertions to be enabled')
