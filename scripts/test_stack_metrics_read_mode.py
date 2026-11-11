"""Exercise historical metrics limits without contacting Prometheus."""
import contextlib
import io
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch


class MetricsReadModeTest(unittest.TestCase):
    def setUp(self):
        self.probe = runpy.run_path(str(Path(__file__).with_name("stack-metrics-read-probe.py")))

    def test_invalid_ranges_never_open_a_connection(self):
        for start, end in ((0, 1), (10, 10), (11, 10), (1, 3602), (9999, 10000), (-2, -1)):
            with self.subTest(start=start, end=end), patch("time.time", return_value=10000), patch("urllib.request.build_opener") as build:
                with patch.object(sys, "argv", ["probe", str(start), str(end)]):
                    with self.assertRaisesRegex(ValueError, "Invalid historical metric range"):
                        self.probe["main"]()
                build.assert_not_called()

    def test_invalid_responses_are_rejected(self):
        with patch("urllib.request.build_opener") as build, patch.object(sys, "argv", ["probe", "1", "2"]):
            response = build.return_value.open.return_value.__enter__.return_value
            for status, raw in ((500, b"{}"), (200, b" " * 2097153)):
                with self.subTest(status=status, size=len(raw)):
                    response.status = status
                    response.read.return_value = raw
                    with self.assertRaisesRegex(ValueError, "Invalid historical metric response"):
                        self.probe["main"]()
                    response.read.assert_called_with(2097153)

    def test_valid_boundary_preserves_fixed_loopback_query(self):
        with patch("urllib.request.build_opener") as build, patch("time.time", return_value=10000), patch.object(sys, "argv", ["probe", "1", "3601"]):
            response = build.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'{"status":"success"}'
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.probe["main"]()
            self.assertEqual(output.getvalue().strip(), '{"status": "success"}')
            url = build.return_value.open.call_args.args[0]
            self.assertTrue(url.startswith("http://127.0.0.1:9090/api/v1/query_range?"))
            self.assertIn("start=1&end=3601&step=30", url)
            self.assertEqual(build.call_args.args[0].proxies, {})
            with self.assertRaisesRegex(ValueError, "Metrics redirect refused"):
                build.call_args.args[1].redirect_request()
