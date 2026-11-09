"""Verify the log probe's bounds without contacting Loki."""
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch


class LogsReadModeTest(unittest.TestCase):
    def test_refuses_invalid_range_and_response(self):
        main = runpy.run_path(str(Path(__file__).with_name("stack-logs-read-probe.py")))["main"]
        with patch("urllib.request.build_opener") as build:
            with patch.object(sys, "argv", ["probe", "1", "604802"]):
                with self.assertRaisesRegex(ValueError, "Invalid historical log range"):
                    main()
            build.assert_not_called()

            response = build.return_value.open.return_value.__enter__.return_value
            with patch.object(sys, "argv", ["probe", "1", "2"]):
                for status, raw in ((500, b"{}"), (200, b" " * 2097153)):
                    with self.subTest(status=status, size=len(raw)):
                        response.status = status
                        response.read.return_value = raw
                        with self.assertRaisesRegex(ValueError, "Invalid historical log response"):
                            main()
                        response.read.assert_called_with(2097153)
