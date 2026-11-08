import copy
import unittest
from stack_v18_transition_probe import MANAGEMENT, snapshot, verify


class Fixture:
    def __init__(self, fault=None):
        self.fault = fault
        self.calls = []
        self.version = 0
        self.legacy = {'stack_audit': {'rows': 0, 'sha256': 'a' * 64},
                       **{'table_' + str(i): {'rows': 0, 'sha256': 'b' * 64} for i in range(16)}}
        self.rows = copy.deepcopy(self.legacy)

    def sql(self, query):
        self.calls.append(('sql', query))
        if query.startswith('SELECT count(*) FROM flyway_schema_history'):
            return str(self.version).encode()
        if 'INSERT INTO stack_audit' in query:
            assert self.version == 17
            self.rows['stack_audit'] = {'rows': 1, 'sha256': 'c' * 64}
        if 'INSERT INTO stack_project_settings' in query:
            assert self.version == 18 and 'SET LOCAL ROLE agenttrust_stack_api' in query
            for name in MANAGEMENT:
                self.rows[name] = {'rows': 1, 'sha256': 'd' * 64}
        return b''

    def capture(self):
        return copy.deepcopy(self.rows)

    def process(self, kind, env, args, expected, selected_image=None):
        self.calls.append(('process', kind, selected_image, tuple(args)))
        assert expected == 0
        if kind == 'v17-baseline-migrate':
            self.version = 17
            return {'migrationsExecuted': 18 if self.fault == 'wrong-baseline' else 17}
        if kind == 'v18-candidate-migrate':
            self.version = 18
            for name in MANAGEMENT:
                self.rows[name] = {'rows': 0, 'sha256': 'e' * 64}
            if self.fault == 'legacy-drift':
                self.rows['stack_audit']['sha256'] = 'f' * 64
            return {'migrationsExecuted': 0 if self.fault == 'not-one-migration' else 1}
        if kind == 'v18-old-api-return':
            if self.fault == 'old-role-rejected':
                raise ValueError('RESTRICTED_ROLE_REFUSED')
            if self.fault == 'revocation-loss':
                self.rows['stack_access_key_revocations']['rows'] = 0
        if kind == 'v18-forward-repeat':
            return {'migrationsExecuted': 1 if self.fault == 'reapplied' else 0}
        return {'restrictedApiRoleVerified': True}

    def verify(self):
        return verify(self.sql, self.process, 'migration-env', 'api-env', 'old-image', capture=self.capture)


class TransitionTest(unittest.TestCase):
    def test_full_transition_return_and_forward_retain_exact_rows_without_old_migrator(self):
        fixture = Fixture(); result = fixture.verify()
        self.assertTrue(result['completed'])
        self.assertEqual(result['existingTablesPreserved'], 17)
        self.assertEqual(result['managementTablesRetained'], 3)
        processes = [v for v in fixture.calls if v[0] == 'process']
        self.assertEqual([v[1] for v in processes], ['v17-baseline-migrate', 'v17-restricted-api',
                         'v18-candidate-migrate', 'v18-candidate-api', 'v18-old-api-return',
                         'v18-forward-repeat', 'v18-forward-api'])
        self.assertEqual([v[1] for v in processes if v[2] == 'old-image' and v[3] == ('--migrate-only',)],
                         ['v17-baseline-migrate'])
        for flag in ('oldFullApiBusinessFlowVerified', 'operatingRecoveryVerified',
                     'actualDeploymentPerformed', 'automaticDeploymentAllowed', 'healthyRollbackGuaranteed'):
            self.assertIs(result[flag], False)

    def test_wrong_baseline_or_non_single_upgrade_refused(self):
        for fault in ('wrong-baseline', 'not-one-migration'):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                Fixture(fault).verify()

    def test_existing_business_row_drift_refused(self):
        with self.assertRaises(ValueError):
            Fixture('legacy-drift').verify()

    def test_old_role_rejection_is_not_rollback_success(self):
        with self.assertRaises(ValueError):
            Fixture('old-role-rejected').verify()

    def test_revocation_loss_or_migration_reapply_refused(self):
        for fault in ('revocation-loss', 'reapplied'):
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                Fixture(fault).verify()

    def test_snapshot_reads_bounded_exact_fingerprints_without_row_export(self):
        calls = []
        def sql(query):
            calls.append(query)
            return b'["stack_audit"]' if 'pg_tables' in query else ('BEGIN\nSET\n1|' + 'a' * 64 + '\nROLLBACK\n').encode()
        self.assertEqual(snapshot(sql), {'stack_audit': {'rows': 1, 'sha256': 'a' * 64}})
        self.assertIn('BEGIN READ ONLY', calls[-1])
        self.assertIn("statement_timeout='2s'", calls[-1])

    def test_snapshot_refuses_substituted_relation_name(self):
        with self.assertRaises(ValueError):
            snapshot(lambda query: b'["stack_audit;DROP TABLE stack_runs"]')


if __name__ == '__main__':
    unittest.main()
