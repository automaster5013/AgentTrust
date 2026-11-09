"""Confirm optimization preserves the embedded worker probe's request checks."""
import ast
import dis
from pathlib import Path
from types import CodeType
import unittest


class WorkerProbeChecksTest(unittest.TestCase):
    def test_optimized_probe_retains_all_evaluation_request_sites(self):
        path = Path(__file__).with_name('stack-isolated-worker-rehearsal.py')
        source = ast.parse(path.read_bytes())
        probe = next(
            assignment.value.value for assignment in source.body
            if isinstance(assignment, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'PROBE'
                    for target in assignment.targets)
        )
        compiled = compile(probe, '<worker fixture probe>', 'exec', optimize=1)
        main = next(constant for constant in compiled.co_consts
                    if isinstance(constant, CodeType) and constant.co_name == 'main')
        paths = [instruction.argval for instruction in dis.get_instructions(main)
                 if instruction.opname == 'LOAD_CONST' and instruction.argval == '/evaluate']
        self.assertEqual(len(paths), 3)
