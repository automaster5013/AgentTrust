import unittest
from stack_ci_artifacts import diagnostic_artifact_revision, select_diagnostic_artifact


class ArtifactAttemptTest(unittest.TestCase):
    revision = 'a' * 40
    def artifact(self, attempt=None, **extra):
        return {'name': 'original-stack-diagnostics-' + ('' if attempt is None else 'attempt-' + str(attempt) + '-') + self.revision,
                'expired': False, **extra}

    def test_legacy_first_attempt_remains_readable(self):
        item = self.artifact()
        self.assertIs(select_diagnostic_artifact([item], self.revision, 1), item)
        previous = self.artifact(name='original-stack-diagnostics-' + self.revision + '-attempt-2')
        self.assertIs(select_diagnostic_artifact([previous], self.revision, 2), previous)

    def test_current_attempt_selected_while_prior_failure_is_retained(self):
        first = self.artifact(1); second = self.artifact(2)
        items = [first, second]
        self.assertIs(select_diagnostic_artifact(items, self.revision, 2), second)
        self.assertEqual(items, [first, second])
        self.assertIs(select_diagnostic_artifact([self.artifact(), second], self.revision, 2), second)

    def test_missing_current_attempt_never_falls_back_to_old_success(self):
        for items in ([self.artifact()], [self.artifact(1)], [self.artifact(3)]):
            with self.assertRaises(ValueError): select_diagnostic_artifact(items, self.revision, 2)

    def test_ambiguity_expiry_and_wrong_revision_are_refused(self):
        for items in ([self.artifact(), self.artifact(1)], [self.artifact(2, expired=True)],
                      [self.artifact(2, name='original-stack-diagnostics-' + 'b'*40 + '-attempt-2')]):
            with self.assertRaises(ValueError): select_diagnostic_artifact(items, self.revision, 2 if len(items)==1 else 1)

    def test_attempt_and_name_contract_is_strict(self):
        for name in ('original-stack-diagnostics-attempt-02-' + self.revision,
                     'original-stack-diagnostics-' + self.revision + '-attempt-02',
                     'original-stack-diagnostics-' + self.revision + '-attempt-2-extra', None):
            self.assertIsNone(diagnostic_artifact_revision(name, 2))
        for attempt in (True, 0, '2', 10000):
            with self.assertRaises(ValueError): diagnostic_artifact_revision(self.artifact()['name'], attempt)

    def test_ambiguity_never_selects_by_order_or_modifies_prior_evidence(self):
        first = self.artifact(2, id=1); second = self.artifact(2, id=2)
        for items in ([first, second], [second, first]):
            before = list(items)
            with self.assertRaises(ValueError): select_diagnostic_artifact(items, self.revision, 2)
            self.assertEqual(items, before)

    def test_foreign_or_malformed_revision_is_refused(self):
        for revision in (None, True, b'a'*40, 'b'*40, 'a'*39):
            with self.subTest(revisionType=type(revision).__name__), self.assertRaises(ValueError):
                select_diagnostic_artifact([self.artifact(2)], revision, 2)


if __name__ == '__main__': unittest.main()
