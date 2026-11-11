"""Check policy bindings in disposable roots without touching runtime policy."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class PolicyMetadataModeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.script = self.root / "scripts/stack-policy-metadata.py"
        self.script.parent.mkdir()
        shutil.copyfile(Path(__file__).with_name(self.script.name), self.script)
        self.source = self.root / "services/opa/policies/release.rego"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"package agenttrust\n")
        self.version = self.root / "services/opa/policy-version.txt"
        self.version.write_text("1.2.3\n", encoding="utf-8")
        self.expected = {"agenttrust": {"policy": {
            "version": "1.2.3", "digest": "sha256:" + hashlib.sha256(self.source.read_bytes()).hexdigest()}}}
        self.targets = [self.root / "services/opa/policies/metadata.json",
                        self.root / "services/core-api/src/main/resources/policy-metadata.json"]
        for target in self.targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(self.expected), encoding="utf-8")

    def run_probe(self, *args):
        mode = ["-O"] if sys.flags.optimize else []
        return subprocess.run([sys.executable, *mode, str(self.script), *args],
                              capture_output=True, text=True, timeout=10)

    def test_valid_check_is_read_only(self):
        before = [p.read_bytes() for p in self.targets]
        result = self.run_probe("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["mode"], "check")
        self.assertEqual([p.read_bytes() for p in self.targets], before)

    def test_each_mismatched_target_is_refused_without_writing(self):
        for target in self.targets:
            with self.subTest(target=target.relative_to(self.root)):
                original = target.read_bytes()
                target.write_text('{"agenttrust":{"policy":{"version":"9.9.9"}}}', encoding="utf-8")
                before = [p.read_bytes() for p in self.targets]
                result = self.run_probe("--check")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('"completed": true', result.stdout)
                self.assertEqual([p.read_bytes() for p in self.targets], before)
                target.write_bytes(original)

    def test_invalid_version_never_checks_or_generates_metadata(self):
        self.version.write_text("not-a-version", encoding="utf-8")
        for args in [(), ("--check",)]:
            with self.subTest(args=args):
                before = [p.read_bytes() for p in self.targets]
                result = self.run_probe(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('"completed": true', result.stdout)
                self.assertEqual([p.read_bytes() for p in self.targets], before)

    def test_generation_binds_both_targets_to_policy_bytes(self):
        for target in self.targets:
            target.write_text("{}", encoding="utf-8")
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["mode"], "generate")
        for target in self.targets:
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), self.expected)
