"""Own one fresh source-scanner work tree; never clean a pre-existing path."""
import pathlib,shutil,tempfile

class OwnedScanWork:
    def __init__(self,parent):
        self.parent=pathlib.Path(parent).resolve(strict=True)
        if not self.parent.is_dir():raise ValueError('Scanner parent unavailable')
        state=self.parent.stat();self.parent_identity=(state.st_dev,state.st_ino)
        self.path=pathlib.Path(tempfile.mkdtemp(prefix='owned-source-',dir=self.parent)).resolve(strict=True)
        state=self.path.stat();self.identity=(state.st_dev,state.st_ino);self.closed=False
    def __enter__(self):return self.path
    def close(self):
        if self.closed:return
        state=self.parent.stat()
        if self.parent.is_symlink() or self.parent.is_junction() or (state.st_dev,state.st_ino)!=self.parent_identity:raise ValueError('Scanner parent ownership changed')
        if self.path.is_symlink() or self.path.is_junction() or self.path.resolve(strict=True).parent!=self.parent:raise ValueError('Scanner work ownership changed')
        state=self.path.stat()
        if not self.path.is_dir() or (state.st_dev,state.st_ino)!=self.identity:raise ValueError('Scanner work ownership changed')
        # This resolved absolute tree was created by this instance; prior scans are outside it.
        shutil.rmtree(self.path);self.closed=True
    def __exit__(self,kind,error,trace):self.close()
