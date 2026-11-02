import unittest
from stack_owned_fixture import wait_for_owned_fixture_removal


class RemovalTests(unittest.TestCase):
    def check(self, responses, timeout=1):
        clock = [0.0]
        calls = []
        def run(args, cleanup=False):
            calls.append((args, cleanup))
            return responses.pop(0) if len(responses) > 1 else responses[0]
        def sleep(delay):
            clock[0] += delay
        return lambda: wait_for_owned_fixture_removal(run, 'owned-nonce', timeout, monotonic=lambda: clock[0], sleep=sleep), calls, clock

    def test_immediate_removal(self):
        operation, calls, clock = self.check([''])
        operation()
        self.assertEqual(len(calls), 1)
        self.assertEqual(clock[0], 0)

    def test_waits_for_async_removal(self):
        operation, calls, clock = self.check(['fixture-id', 'fixture-id', ''])
        operation()
        self.assertEqual(clock[0], .5)
        self.assertEqual(len(calls), 3)
        for args, cleanup in calls:
            self.assertEqual(args, ['docker', 'ps', '-a', '-q', '--filter', 'label=dev.agenttrust.owner=owned-nonce'])
            self.assertTrue(cleanup)

    def test_timeout_keeps_failure_and_never_forces_deletion(self):
        operation, calls, clock = self.check(['fixture-id'])
        with self.assertRaisesRegex(TimeoutError, 'OWNED_FIXTURE_REMOVAL_NOT_CONFIRMED'):
            operation()
        self.assertEqual(clock[0], 1)
        self.assertEqual(len(calls), 5)
        self.assertTrue(all('rm' not in args and 'stop' not in args for args, _ in calls))

    def test_query_failure_is_not_treated_as_removal(self):
        def fail(*args, **kwargs):
            raise RuntimeError('query failed')
        with self.assertRaisesRegex(RuntimeError, 'query failed'):
            wait_for_owned_fixture_removal(fail, 'owned-nonce')


if __name__ == '__main__':
    unittest.main()
