"""Check the mode guard without running any signing setup operations."""
from pathlib import Path
import unittest


class GateSigningSetupModeTest(unittest.TestCase):
    def test_optimized_setup_exits_before_importing_dependencies(self):
        script = Path(__file__).with_name('stack-gate-signing-setup.py')
        code = compile(script.read_bytes(), str(script), 'exec', optimize=1)

        def blocked_import(*args, **kwargs):
            self.fail('Signing setup attempted an import under optimization')

        scope = {'__builtins__': {'SystemExit': SystemExit, '__import__': blocked_import}}
        with self.assertRaisesRegex(SystemExit, '^Gate signing setup requires Python assertions to be enabled$'):
            exec(code, scope)
