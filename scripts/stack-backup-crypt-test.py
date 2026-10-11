"""Authenticity boundaries for the development backup envelope."""
import importlib.util,pathlib,secrets,unittest
from cryptography.exceptions import InvalidTag
spec=importlib.util.spec_from_file_location('backup_crypt',pathlib.Path(__file__).with_name('stack-backup-crypt.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Boundaries(unittest.TestCase):
    def setUp(self):self.key=secrets.token_bytes(32);self.body=b'bounded synthetic database archive';self.envelope=module.transform('encrypt',self.key,self.body)
    def test_roundtrip_and_independent_nonces(self):
        self.assertEqual(module.transform('decrypt',self.key,self.envelope),self.body)
        self.assertNotEqual(module.transform('encrypt',self.key,self.body),self.envelope)
    def test_changed_ciphertext_refused(self):
        changed=self.envelope[:-1]+bytes([self.envelope[-1]^1])
        with self.assertRaises(InvalidTag):module.transform('decrypt',self.key,changed)
    def test_other_key_refused(self):
        with self.assertRaises(InvalidTag):module.transform('decrypt',secrets.token_bytes(32),self.envelope)
    def test_changed_nonce_refused(self):
        offset=len(module.MAGIC);changed=self.envelope[:offset]+bytes([self.envelope[offset]^1])+self.envelope[offset+1:]
        with self.assertRaises(InvalidTag):module.transform('decrypt',self.key,changed)
    def test_header_and_truncation_refused(self):
        for value in [b'',b'wrong',self.envelope[:-16],b'X'+self.envelope[1:]]:
            with self.assertRaises((ValueError,InvalidTag)):module.transform('decrypt',self.key,value)
    def test_size_key_and_operation_refused(self):
        for operation,key,data in [('encrypt',b'x',self.body),('unknown',self.key,self.envelope),('encrypt',self.key,b''),('encrypt',self.key,b'x'*(module.LIMIT+1))]:
            with self.assertRaises(ValueError):module.transform(operation,key,data)
    def test_envelope_overhead_does_not_break_accepted_roundtrip(self):
        with self.assertRaises(ValueError):module.transform('encrypt',self.key,b'x'*(module.PLAIN_LIMIT+1))

if __name__=='__main__':unittest.main()
