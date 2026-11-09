"""Verify Console probe outcomes using mocked commands and report writes."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import runpy
import subprocess
import unittest
from unittest.mock import patch


class ConsoleHealthProbeTest(unittest.TestCase):
    def test_probe_validates_health_status_and_container_identity(self):
        script = Path(__file__).with_name("stack-console-health-probe-smoke.py")
        healthy = "fixture|image|0|healthy|false"
        allowed = '{"allowed":200,"foreign":200,"foreignBackend":403}'
        refused = '{"allowed":200,"foreign":200,"foreignBackend":200}'
        cases = (
            ("unhealthy", ["fixture|image|0|unhealthy|false"], False),
            ("foreign backend accepted", [healthy, refused], False),
            ("container changed", [healthy, allowed, "other|image|0|healthy|false"], False),
            ("valid", [healthy, allowed, healthy], True),
        )
        for name, outputs, completed in cases:
            with self.subTest(name=name):
                results = [subprocess.CompletedProcess([], 0, output) for output in outputs]
                with (
                    patch.object(subprocess, "run", side_effect=results) as command,
                    patch.object(Path, "write_text") as write_report,
                    redirect_stdout(io.StringIO()),
                ):
                    if completed:
                        runpy.run_path(str(script), run_name="__main__")
                    else:
                        with self.assertRaises(SystemExit) as exit_status:
                            runpy.run_path(str(script), run_name="__main__")
                        self.assertEqual(exit_status.exception.code, 1)
                self.assertEqual(command.call_count, len(outputs))
                report = json.loads(write_report.call_args.args[0])
                self.assertIs(report["completed"], completed)
                self.assertEqual(report.get("code"), None if completed else "CONSOLE_HEALTH_PROBE_UNVERIFIED")
