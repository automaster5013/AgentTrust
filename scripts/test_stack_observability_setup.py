"""Check malformed observability setup data in an isolated synthetic directory."""
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


class ObservabilitySetupTest(unittest.TestCase):
    def test_invalid_existing_file_is_preserved_and_rejected(self):
        source = Path(__file__).with_name('stack-observability-setup.py')
        with TemporaryDirectory() as folder:
            root = Path(folder)
            script = root / 'scripts' / source.name
            script.parent.mkdir()
            script.write_bytes(source.read_bytes())
            fixture = root / '.local' / 'stack' / 'grafana-password'
            fixture.parent.mkdir(parents=True)
            original = b'malformed-synthetic-fixture'
            fixture.write_bytes(original)

            for mode in ([], ['-O']):
                with self.subTest(mode=mode):
                    result = subprocess.run(
                        [sys.executable, '-I', '-S', *mode, str(script)],
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, '')
                    self.assertEqual(result.stderr.strip(),
                                     'Observability setup file has an invalid format')
                    self.assertEqual(fixture.read_bytes(), original)
