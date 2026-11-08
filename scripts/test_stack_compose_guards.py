"""Check compose argument construction without reading local files or running Docker."""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from stack_compose import stack_compose


class ComposeGuardsTest(unittest.TestCase):
    def test_partial_image_cohort_is_refused(self):
        reference = 'ghcr.io/example/agenttrust-core@sha256:' + 'a' * 64
        with patch.dict(os.environ, {'STACK_CORE_IMAGE': reference}, clear=True), patch.object(Path, 'exists', return_value=False):
            with self.assertRaises((AssertionError, ValueError)):
                stack_compose(Path('synthetic'))

    def test_signing_requires_valid_marker_and_key_file(self):
        for marker, key_exists in (('unexpected', True), ('local-development-v1', False)):
            with self.subTest(marker=marker, key_exists=key_exists), patch.dict(os.environ, {}, clear=True):
                with patch.object(Path, 'exists', autospec=True, side_effect=lambda path: path.name == 'signing-enabled'), patch.object(Path, 'read_text', return_value=marker), patch.object(Path, 'is_file', return_value=key_exists):
                    with self.assertRaises((AssertionError, ValueError)):
                        stack_compose(Path('synthetic'))

    def test_valid_signing_marker_keeps_overlay(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(Path, 'exists', autospec=True, side_effect=lambda path: path.name == 'signing-enabled'), patch.object(Path, 'read_text', return_value='local-development-v1'), patch.object(Path, 'is_file', return_value=True):
            self.assertIn('compose.stack.signing.yaml', stack_compose(Path('synthetic')))
