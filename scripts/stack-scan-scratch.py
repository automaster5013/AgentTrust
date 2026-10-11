"""Delete only scanner archives created in this invocation's private scratch directory."""
import pathlib

class ScanScratch:
    def __init__(self, directory):
        self.directory = pathlib.Path(directory).resolve(strict=True)
        if not self.directory.is_dir():
            raise ValueError('Scratch directory unavailable')
        self.owned = set()

    def reserve(self, name):
        if not name or pathlib.Path(name).name != name or not name.endswith('.tar'):
            raise ValueError('Invalid archive name')
        path = self.directory / name
        if path.exists() or path.is_symlink():
            raise ValueError('Archive already exists')
        if self.directory.resolve(strict=True) != self.directory:
            raise ValueError('Scratch directory changed')
        self.owned.add(path)
        return path

    def remove(self, path):
        path = pathlib.Path(path)
        if path not in self.owned or path.parent != self.directory:
            raise ValueError('Archive is not owned by this invocation')
        if self.directory.resolve(strict=True) != self.directory or path.is_symlink():
            raise ValueError('Archive path changed')
        if path.exists():
            if not path.is_file():
                raise ValueError('Archive is not a file')
            path.unlink()
        self.owned.remove(path)

    def close(self):
        for path in tuple(self.owned):
            self.remove(path)
