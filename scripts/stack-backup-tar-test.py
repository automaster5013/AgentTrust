"""Refuse unsafe restore paths and file types before a fixture volume is mounted."""
import io,tarfile,unittest
from stack_backup_tools import minio_tar_fingerprints

def archive(name='./minio-data/object',kind=tarfile.REGTYPE,mode=0o600,duplicate=False):
    raw=io.BytesIO()
    with tarfile.open(fileobj=raw,mode='w') as output:
        item=tarfile.TarInfo(name);item.type=kind;item.mode=mode
        if kind==tarfile.REGTYPE:item.size=4
        if kind in [tarfile.SYMTYPE,tarfile.LNKTYPE]:item.linkname='/outside'
        output.addfile(item,io.BytesIO(b'data') if kind==tarfile.REGTYPE else None)
        if duplicate:output.addfile(item,io.BytesIO(b'data'))
    return raw.getvalue()

class Boundaries(unittest.TestCase):
    def test_regular_volume_file(self):self.assertEqual(4,minio_tar_fingerprints(archive())['minio-data/object']['bytes'])
    def test_sticky_volume_root_is_preserved(self):
        raw=io.BytesIO()
        with tarfile.open(fileobj=raw,mode='w') as output:
            root=tarfile.TarInfo('.');root.type=tarfile.DIRTYPE;root.mode=0o1777;output.addfile(root)
            file=tarfile.TarInfo('./minio-data/object');file.size=4;file.mode=0o600;output.addfile(file,io.BytesIO(b'data'))
        self.assertEqual(4,minio_tar_fingerprints(raw.getvalue())['minio-data/object']['bytes'])
    def test_absolute_parent_other_prefix_and_backslash(self):
        for name in ['/outside','./minio-data/../../outside','other/data','minio-data\\outside']:
            with self.assertRaises(ValueError):minio_tar_fingerprints(archive(name=name))
    def test_links_devices_and_named_pipes(self):
        for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.CHRTYPE,tarfile.BLKTYPE,tarfile.FIFOTYPE]:
            with self.assertRaises(ValueError):minio_tar_fingerprints(archive(kind=kind))
    def test_duplicate_and_setuid(self):
        for value in [archive(duplicate=True),archive(mode=0o4600)]:
            with self.assertRaises(ValueError):minio_tar_fingerprints(value)
    def test_file_ancestor_conflicts_are_refused_in_both_tar_orders(self):
        parent = ('minio-data/base', tarfile.REGTYPE)
        for kind in (tarfile.REGTYPE, tarfile.DIRTYPE):
            child = ('minio-data/base/child', kind)
            for entries in ([parent, child], [child, parent]):
                raw = io.BytesIO()
                with tarfile.open(fileobj=raw, mode='w') as output:
                    for name, entry_kind in entries:
                        item = tarfile.TarInfo(name)
                        item.type, item.mode = entry_kind, 0o700
                        item.size = 1 if entry_kind == tarfile.REGTYPE else 0
                        output.addfile(item, io.BytesIO(b'x') if item.size else None)
                with self.subTest(kind=kind, parent_first=entries[0] == parent):
                    with self.assertRaises(ValueError):
                        minio_tar_fingerprints(raw.getvalue())

    def test_explicit_parent_directory_remains_valid_before_or_after_child(self):
        for parent_first in (True, False):
            raw = io.BytesIO()
            names = ['minio-data/base', 'minio-data/base/object']
            if not parent_first:
                names.reverse()
            with tarfile.open(fileobj=raw, mode='w') as output:
                for name in names:
                    item = tarfile.TarInfo(name)
                    item.type = tarfile.DIRTYPE if name == 'minio-data/base' else tarfile.REGTYPE
                    item.mode, item.size = 0o700, 0 if item.isdir() else 1
                    output.addfile(item, io.BytesIO(b'x') if item.size else None)
            with self.subTest(parent_first=parent_first):
                self.assertEqual(set(minio_tar_fingerprints(raw.getvalue())), {'minio-data/base/object'})

    def test_empty_and_truncated(self):
        with self.assertRaises(ValueError):minio_tar_fingerprints(b'')
        with self.assertRaises((ValueError,tarfile.ReadError)):minio_tar_fingerprints(archive()[:100])

if __name__=='__main__':unittest.main()
