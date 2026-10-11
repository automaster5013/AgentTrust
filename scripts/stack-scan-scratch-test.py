"""Filesystem boundary checks for scanner-owned temporary archive cleanup."""
import importlib.util,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('scratch',pathlib.Path(__file__).with_name('stack-scan-scratch.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Boundaries(unittest.TestCase):
    def test_cleanup_preserves_reports_and_unowned_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder); report=root/'report.json';report.write_bytes(b'proof')
            retained=root/'previous.tar';retained.write_bytes(b'baseline')
            scratch=module.ScanScratch(root); archive=scratch.reserve('current.tar');archive.write_bytes(b'image')
            scratch.close()
            self.assertFalse(archive.exists());self.assertEqual(b'proof',report.read_bytes());self.assertEqual(b'baseline',retained.read_bytes())

    def test_rejects_existing_archive_and_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);(root/'existing.tar').write_bytes(b'preserve');scratch=module.ScanScratch(root)
            for name in ['existing.tar','../outside.tar','nested/image.tar','report.json','']:
                with self.subTest(name=name),self.assertRaises(ValueError):scratch.reserve(name)
            with self.assertRaises(ValueError):scratch.remove(root/'existing.tar')
            self.assertEqual(b'preserve',(root/'existing.tar').read_bytes())

    def test_partial_export_is_removed_after_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            scratch=module.ScanScratch(folder);archive=scratch.reserve('partial.tar');archive.write_bytes(b'partial')
            try:raise RuntimeError('scanner failed')
            except RuntimeError:pass
            finally:scratch.close()
            self.assertFalse(archive.exists())

    def test_directory_replacement_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            scratch=module.ScanScratch(folder);archive=scratch.reserve('replaced.tar');archive.mkdir()
            with self.assertRaises(ValueError):scratch.close()
            self.assertTrue(archive.is_dir())

if __name__=='__main__':unittest.main()
