"""Check configured JetStream reservations without reading credentials or starting services."""
import ast
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def arithmetic(node):
    if isinstance(node, ast.Constant) and type(node.value) is int:
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
        return arithmetic(node.left) * arithmetic(node.right)
    raise ValueError('Queue byte limit must be an explicit positive integer')


def file_reservations():
    result = []
    for name in ['app.py', 'quality_worker.py', 'recorded_worker.py', 'connector_worker.py']:
        source = ast.parse((ROOT / 'services/ai-worker' / name).read_text(encoding='utf-8'))
        calls = [node for node in ast.walk(source) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == 'StreamConfig']
        if len(calls) != 1:
            raise ValueError('Expected one explicit stream per evaluator')
        args = {item.arg: item.value for item in calls[0].keywords}
        storage = args['storage']
        if not isinstance(storage, ast.Attribute) or storage.attr != 'FILE':
            raise ValueError('Recorded evaluations must retain file-backed queue durability')
        limit = arithmetic(args['max_bytes'])
        if limit <= 0:
            raise ValueError('Stream storage must remain bounded')
        result.append(limit)
    return result


class RecordedQueueCapacityTests(unittest.TestCase):
    def test_server_can_admit_all_four_bounded_file_streams(self):
        for name in ['stack-setup.py', 'stack-https-identity-smoke.py']:
            with self.subTest(generator=name):
                source = ast.parse((ROOT / 'scripts' / name).read_text(encoding='utf-8'))
                constants = [node.value for node in ast.walk(source) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
                configurations = [value for value in constants if 'max_file_store:' in value]
                self.assertEqual(len(configurations), 1)
                match = re.search(r'max_file_store:\s*(\d+)MB\b', configurations[0])
                self.assertIsNotNone(match)
                capacity = int(match.group(1)) * 1024 * 1024
                self.assertLessEqual(sum(file_reservations()), capacity, 'Four stream MaxBytes reservations exceed the server file-store limit')
                self.assertLessEqual(capacity, 64 * 1024 * 1024, 'Candidate queue storage must remain explicitly bounded')


if __name__ == '__main__':
    unittest.main()
