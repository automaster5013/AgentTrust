"""Compile recovery entry points without invoking any lifecycle operations."""
import dis
from pathlib import Path
from types import CodeType
import unittest


def request_references(code):
    count = sum(instruction.opname in ('LOAD_ATTR', 'LOAD_METHOD') and instruction.argval == 'request'
                for instruction in dis.get_instructions(code))
    return count + sum(request_references(value) for value in code.co_consts if isinstance(value, CodeType))


class RecoveryEntrypointGuardsTest(unittest.TestCase):
    def test_request_checks_survive_optimized_compilation(self):
        for name in ('stack-campaign-recovery.py', 'stack-recovery-smoke.py'):
            with self.subTest(entrypoint=name):
                path = Path(__file__).with_name(name)
                source = path.read_text(encoding='utf-8')
                normal = request_references(compile(source, str(path), 'exec', optimize=0))
                optimized = request_references(compile(source, str(path), 'exec', optimize=1))
                self.assertGreater(normal, 0)
                self.assertEqual(optimized, normal)
