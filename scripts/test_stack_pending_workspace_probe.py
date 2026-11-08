"""Synthetic SQL transcripts only; never contact a database."""
import re
import unittest
import uuid
from stack_pending_workspace_probe import verify


class Fixture:
    def __init__(self, fault=None):
        self.fault = fault
        self.scopes = [(org, str(uuid.UUID(int=i + 1))) for org in
                       ('7fffffff-ffff-ffff-ffff-ffffffffffff', '80000000-0000-0000-0000-000000000000')
                       for i in range(5)]
        self.completed = False
        self.pages = 0
        self.capabilities = 0
        self.commands = []

    def sql(self, statement):
        self.commands.append(statement)
        if statement.startswith('SELECT (p.prosecdef'):
            self.capabilities += 1
            return b'f' if self.fault == 'capability' else b't'
        rows = []
        if 'INSERT INTO public.stack_run_results' in statement:
            self.completed = True
        if 'SELECT organization_id::text' in statement:
            self.pages += 1
            cursor = re.search(r"stack_pending_workspaces\('([^']+)'::uuid,'([^']+)'::uuid\)", statement)
            if cursor:
                index = self.scopes.index(cursor.groups()) + 1
                rows = self.scopes[index:index + 8]
            else:
                rows = self.scopes[1:9] if self.completed else self.scopes[:8]
                if self.fault == 'completed' and self.completed:
                    rows = self.scopes[:8]
                if self.fault == 'pagination' and not self.completed:
                    rows = list(reversed(rows))
            return ('BEGIN\n' + '\n'.join('|'.join(row) for row in rows) + '\nROLLBACK').encode()
        count = None
        if 'CREATE TEMP TABLE stack_runs' in statement:
            count = 0 if self.fault == 'shadow' else 8
        elif 'SELECT count(*) FROM public.stack_runs' in statement:
            count = 2 if self.fault == 'rls' else 1
        elif 'SELECT count(*) FROM public.stack_run_results' in statement:
            count = 0
        elif 'SELECT count(*) FROM public.stack_pending_workspaces' in statement:
            count = 0
        return ('BEGIN\n' + (str(count) + '\n' if count is not None else '') + 'ROLLBACK').encode()


class PendingWorkspaceProbeTests(unittest.TestCase):
    def test_all_mocked_observations_run_before_success(self):
        fixture = Fixture()
        self.assertTrue(verify(fixture.sql)['completed'])
        self.assertEqual(fixture.pages, 4)
        self.assertEqual(fixture.capabilities, 2)

    def test_scoped_row_leak_cannot_claim_verified(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(Fixture('rls').sql)

    def test_incorrect_pagination_cannot_claim_verified(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(Fixture('pagination').sql)

    def test_unrestricted_capability_cannot_claim_verified(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(Fixture('capability').sql)

    def test_shadow_table_substitution_cannot_claim_verified(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(Fixture('shadow').sql)

    def test_completed_work_cannot_remain_pending(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(Fixture('completed').sql)


if __name__ == '__main__':
    unittest.main()
