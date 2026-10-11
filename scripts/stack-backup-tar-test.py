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
    def test_empty_and_truncated(self):
        with self.assertRaises(ValueError):minio_tar_fingerprints(b'')
        with self.assertRaises((ValueError,tarfile.ReadError)):minio_tar_fingerprints(archive()[:100])

if __name__=='__main__':unittest.main()
