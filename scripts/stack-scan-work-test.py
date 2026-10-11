"""Actual filesystem ownership and error cleanup boundaries, not vulnerability scans."""
import pathlib,tempfile,unittest
from stack_scan_work import OwnedScanWork

class OwnedScanWorkTests(unittest.TestCase):
    def test_only_new_work_is_removed_and_reports_preserved(self):
        with tempfile.TemporaryDirectory() as value:
            parent=pathlib.Path(value);report=parent/'summary.json';report.write_text('preserved',encoding='utf-8');previous=parent/'previous-source';previous.mkdir();(previous/'keep').write_text('source',encoding='utf-8')
            with OwnedScanWork(parent) as work:
                (work/'source').mkdir();(work/'source'/'app.py').write_text('temporary copy',encoding='utf-8');owned=work
            self.assertFalse(owned.exists());self.assertEqual(report.read_text(encoding='utf-8'),'preserved');self.assertEqual((previous/'keep').read_text(encoding='utf-8'),'source')
    def test_failed_scan_still_closes_owned_work(self):
        with tempfile.TemporaryDirectory() as parent:
            with self.assertRaises(RuntimeError):
                with OwnedScanWork(parent) as work:(work/'partial.tar').write_bytes(b'partial');raise RuntimeError('scan failed')
            self.assertFalse(work.exists())
    def test_replaced_work_is_refused_without_deleting_replacement(self):
        with tempfile.TemporaryDirectory() as parent:
            owner=OwnedScanWork(parent);old=owner.path.with_name('original');owner.path.rename(old);owner.path.mkdir();(owner.path/'keep').write_text('external',encoding='utf-8')
            with self.assertRaises(ValueError):owner.close()
            self.assertEqual((owner.path/'keep').read_text(encoding='utf-8'),'external');self.assertTrue(old.is_dir())
    def test_close_is_idempotent(self):
        with tempfile.TemporaryDirectory() as parent:
            owner=OwnedScanWork(parent);owner.close();owner.close();self.assertFalse(owner.path.exists())
if __name__=='__main__':unittest.main()
