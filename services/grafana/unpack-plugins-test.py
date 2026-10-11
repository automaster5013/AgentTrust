"""Adversarial archive checks; cryptographic signatures are tested in Grafana itself."""
import hashlib
import importlib.util
import json
import pathlib
import stat
import unittest
import uuid
import zipfile

spec = importlib.util.spec_from_file_location('unpack', pathlib.Path(__file__).with_name('unpack-plugins.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = pathlib.Path(__file__).resolve().parents[2]


class Archives(unittest.TestCase):
    def fixture(self, malicious=None, mode=None, checksum=True):
        directory = root / '.local' / ('grafana-archive-fixture-' + str(uuid.uuid4()))
        directory.mkdir(parents=True)
        plugins = []
        for index in range(13):
            identity = 'fixture-' + str(index)
            archive = directory / (identity + '.zip')
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr(identity + '/plugin.json', json.dumps({'id': identity, 'info': {'version': '1.0.0'}}))
                bundle.writestr(identity + '/MANIFEST.txt', 'synthetic manifest; no signature claim')
                if index == 0 and malicious:
                    entry = zipfile.ZipInfo(malicious.replace('{id}', identity))
                    entry.filename = malicious.replace('{id}', identity)
                    entry.external_attr = (mode or (stat.S_IFREG | 0o644)) << 16
                    bundle.writestr(entry, 'malicious fixture')
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            plugins.append({'id': identity, 'version': '1.0.0', 'sha256': digest if checksum or index else '0' * 64})
        lock = directory / 'plugins.lock.json'
        lock.write_text(json.dumps({'schemaVersion': 1, 'grafanaVersion': '13.2.3', 'plugins': plugins}))
        return directory, lock

    def test_complete_packages_preserve_manifest_bytes(self):
        directory, lock = self.fixture()
        module.unpack(lock, directory / 'output')
        self.assertEqual(len(list((directory / 'output').iterdir())), 13)
        self.assertEqual((directory / 'output/fixture-0/MANIFEST.txt').read_text(), 'synthetic manifest; no signature claim')

    def test_escape_symlink_device_and_privileged_files_are_refused(self):
        for name, mode in [('..' + '/escape', None), ('{id}/../escape', None),
                           ('/escape', None), ('{id}\\escape', None),
                           ('{id}/link', stat.S_IFLNK | 0o777),
                           ('{id}/device', stat.S_IFCHR | 0o644),
                           ('{id}/privileged', stat.S_IFREG | stat.S_ISUID | 0o755)]:
            with self.subTest(name=name, mode=mode):
                directory, lock = self.fixture(name, mode)
                with self.assertRaises(ValueError):
                    module.unpack(lock, directory / 'output')
                self.assertFalse((directory / 'escape').exists())

    def test_wrong_checksum_is_refused_before_extraction(self):
        directory, lock = self.fixture(checksum=False)
        with self.assertRaises(ValueError):
            module.unpack(lock, directory / 'output')
        self.assertFalse((directory / 'output/fixture-0').exists())

    def test_existing_output_is_preserved(self):
        directory, lock = self.fixture()
        destination = directory / 'output'
        destination.mkdir()
        (destination / 'existing').write_text('preserve')
        with self.assertRaises(FileExistsError):
            module.unpack(lock, destination)
        self.assertEqual((destination / 'existing').read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
