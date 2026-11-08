"""Mock every database/process operation; read only tracked Java source."""
import pathlib
import unittest
from stack_database_role_probe import verify

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Fixture:
    def __init__(self, fault=None):
        self.fault = fault
        self.drift = None
        self.commands = []
        self.observations = 0
        self.processes = []

    def sql(self, statement):
        self.commands.append(statement)
        if statement.startswith('BEGIN'):
            self.observations += 1
            if self.fault == 'empty-frame':
                return b'BEGIN\nROLLBACK'
            flags = ['t', 't', 't']
            if self.drift is not None:
                flags = ['f' if self.drift.startswith('GRANT CREATE') else 't', 't', 'f']
            if self.fault == 'unsafe-clean' and self.drift is None:
                flags[2] = 'f'
            count = '1' if self.fault == 'pending-work' else '0'
            return ('BEGIN\n' + '\n'.join(flags) + '\n' + count + '\nROLLBACK').encode()
        self.drift = statement if self.drift is None else None
        return b''

    def process(self, label, environment, args, expected):
        self.processes.append(label)
        if expected == 1:
            return {'rejected': True, 'apiRolePolicyRefused': self.fault != 'wrong-denial'}
        return {'restrictedApiRoleVerified': self.fault != 'unrestored'}


class DatabaseRoleProbeTests(unittest.TestCase):
    def test_valid_mocked_control_observes_each_drift_and_restore(self):
        fixture = Fixture()
        report = verify(fixture.sql, fixture.process, {}, ROOT)
        self.assertTrue(report['completed'])
        self.assertEqual(len(report['cases']), 7)
        self.assertEqual(fixture.observations, 15)
        self.assertEqual(len(fixture.processes), 14)
        self.assertIsNone(fixture.drift)

    def test_empty_database_frame_cannot_claim_verified(self):
        fixture = Fixture('empty-frame')
        with self.assertRaises((AssertionError, ValueError)):
            verify(fixture.sql, fixture.process, {}, ROOT)

    def test_unsafe_initial_role_cannot_claim_verified(self):
        fixture = Fixture('unsafe-clean')
        with self.assertRaises((AssertionError, ValueError)):
            verify(fixture.sql, fixture.process, {}, ROOT)

    def test_pending_metadata_rows_cannot_be_ignored(self):
        fixture = Fixture('pending-work')
        with self.assertRaises((AssertionError, ValueError)):
            verify(fixture.sql, fixture.process, {}, ROOT)

    def test_other_process_denial_cannot_prove_role_policy(self):
        fixture = Fixture('wrong-denial')
        with self.assertRaises((AssertionError, ValueError)):
            verify(fixture.sql, fixture.process, {}, ROOT)

    def test_unrestored_process_cannot_claim_recovered(self):
        fixture = Fixture('unrestored')
        with self.assertRaises((AssertionError, ValueError)):
            verify(fixture.sql, fixture.process, {}, ROOT)


if __name__ == '__main__':
    unittest.main()
