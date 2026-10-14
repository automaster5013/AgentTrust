import unittest
from stack_observation_policy import GIB, archive_preflight, official_reference


class ObservationPolicyTests(unittest.TestCase):
    def test_only_exact_pinned_official_grafana_reference_has_larger_bound(self):
        reference = 'grafana/grafana:13.2.4@sha256:'+'a'*64
        self.assertTrue(official_reference('grafana', reference))
        result = archive_preflight('grafana', reference, 2*GIB, 24*GIB, True)
        self.assertEqual(result['minimumReserveBytes'], 22*GIB)
        self.assertEqual(result['maximumArchiveBytes'], 3*GIB)

    def test_mutable_foreign_repository_wrong_component_and_malformed_digest_refused(self):
        for name, reference in [('grafana', 'grafana/grafana:13.2.4'), ('grafana', 'other/grafana:13.2.4@sha256:'+'a'*64),
                                ('loki', 'grafana/grafana:13.2.4@sha256:'+'a'*64), ('grafana', 'grafana/grafana:13.2.4@sha256:'+'A'*64),
                                ('grafana', 'agenttrust-grafana:local;echo bad')]:
            with self.subTest(reference=reference), self.assertRaises(ValueError):official_reference(name, reference)

    def test_byte_below_reserve_refused_before_export(self):
        for windows, reserve in [(True, 22*GIB), (False, 4*GIB)]:
            with self.subTest(windows=windows), self.assertRaises(ValueError):
                archive_preflight('loki', 'agenttrust-loki:local', GIB, reserve+GIB-1, windows)
            self.assertEqual(archive_preflight('loki', 'agenttrust-loki:local', GIB, reserve+GIB, windows)['minimumReserveBytes'], reserve)

    def test_local_and_registry_candidates_keep_one_gib_bound(self):
        for reference in ('agenttrust-grafana:local', 'ghcr.io/automaster5013/agenttrust-grafana@sha256:'+'a'*64):
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                archive_preflight('grafana', reference, GIB+1, 30*GIB, True)

    def test_invalid_size_coercions_and_oversized_official_image_refused(self):
        for size in (True, 0, -1, '100', 3*GIB+1):
            with self.subTest(size=size), self.assertRaises(ValueError):
                archive_preflight('grafana', 'grafana/grafana:13.2.4@sha256:'+'a'*64, size, 30*GIB, True)


if __name__ == '__main__':unittest.main()
