"""Exercise the provider marker contract without running Compose."""
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


class ProviderMarkerTest(unittest.TestCase):
    def test_invalid_marker_is_preserved_and_rejected_by_both_entrypoints(self):
        sources = Path(__file__).parent
        with TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / 'scripts'
            scripts.mkdir()
            (scripts / 'stack_compose.py').write_text(
                "def stack_compose(*args): raise RuntimeError('Compose blocked by test')\n",
                encoding='utf-8',
            )
            marker = root / '.local' / 'stack' / 'providers-enabled'
            marker.parent.mkdir(parents=True)
            original = b'foreign-fixture\n'
            marker.write_bytes(original)
            for kind in ('setup', 'start'):
                with self.subTest(entrypoint=kind):
                    name = f'stack-provider-{kind}.py'
                    entrypoint = scripts / name
                    entrypoint.write_bytes((sources / name).read_bytes())
                    result = subprocess.run(
                        [sys.executable, '-E', '-S', '-O', str(entrypoint)],
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, '')
                    self.assertEqual(result.stderr.strip(), 'Local provider marker is invalid')
                    self.assertEqual(marker.read_bytes(), original)
