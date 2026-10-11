"""Delete only scanner archives created in this invocation's private scratch directory."""
import pathlib

class ScanScratch:
    def __init__(self, directory):
        self.directory = pathlib.Path(directory).resolve(strict=True)
        if not self.directory.is_dir():
            raise ValueError('Scratch directory unavailable')
        info = self.directory.stat()
        self.identity = (info.st_dev, info.st_ino)
        self.owned = set()

    def validate_directory(self):
        info = self.directory.stat()
        if self.directory.resolve(strict=True) != self.directory or (info.st_dev, info.st_ino) != self.identity:
            raise ValueError('Scratch directory changed')

    def reserve(self, name):
        if not name or pathlib.Path(name).name != name or not name.endswith('.tar'):
            raise ValueError('Invalid archive name')
        path = self.directory / name
        if path.exists() or path.is_symlink():
            raise ValueError('Archive already exists')
        self.validate_directory()
        self.owned.add(path)
        return path

    def remove(self, path):
        path = pathlib.Path(path)
        if path not in self.owned or path.parent != self.directory:
            raise ValueError('Archive is not owned by this invocation')
        self.validate_directory()
        if path.is_symlink():
            raise ValueError('Archive path changed')
        if path.exists():
            if not path.is_file():
                raise ValueError('Archive is not a file')
            path.unlink()
        self.owned.remove(path)

    def close(self):
        for path in tuple(self.owned):
            self.remove(path)
