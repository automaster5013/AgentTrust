"""Independent cryptographic controls for restored signing identity acceptance."""
import base64
import copy
import hashlib
import importlib.util
import json
import pathlib
import unittest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

spec = importlib.util.spec_from_file_location('recovery_probe', pathlib.Path(__file__).with_name('stack-coherent-recovery-probe.py'))
probe = importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)


class RecoveredSigningTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        public = self.key.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        self.anchor = {'keyId': hashlib.sha256(public).hexdigest(), 'publicKeySpkiBase64': base64.b64encode(public).decode()}
        self.payload = {'currentDeploymentAuthority': False, 'trustDomain': 'agenttrust-local-development', 'challenge': 'a'*64}
        raw = json.dumps(self.payload).encode()
        self.frame = {'keyId': self.anchor['keyId'], 'signatureAlgorithm': 'Ed25519', 'currentDeploymentAuthority': False,
                      'trustDomain': 'agenttrust-local-development', 'payloadBase64': base64.b64encode(raw).decode(),
                      'payloadSha256': hashlib.sha256(raw).hexdigest(), 'payloadBytes': len(raw),
                      'signatureBase64': base64.b64encode(self.key.sign(raw)).decode()}

    def test_real_signature_against_separately_anchored_public_key(self):
        self.assertEqual(probe.signed_payload(self.frame, self.anchor), self.payload)

    def test_payload_tampering_with_recomputed_size_and_hash_is_cryptographically_refused(self):
        frame = copy.deepcopy(self.frame);payload = {**self.payload, 'challenge': 'b'*64};raw = json.dumps(payload).encode()
        frame.update(payloadBase64=base64.b64encode(raw).decode(), payloadSha256=hashlib.sha256(raw).hexdigest(), payloadBytes=len(raw))
        with self.assertRaises(InvalidSignature):probe.signed_payload(frame, self.anchor)

    def test_other_public_key_cannot_verify_original_bytes(self):
        public = Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
        anchor = {**self.anchor, 'publicKeySpkiBase64': base64.b64encode(public).decode()}
        with self.assertRaises(ValueError):probe.signed_payload(self.frame, anchor)

    def test_changed_key_id_wrong_domain_or_claimed_authority_refused(self):
        for field, value in [('keyId', 'f'*64), ('trustDomain', 'production'), ('currentDeploymentAuthority', True), ('signatureAlgorithm', 'none')]:
            frame = {**self.frame, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):probe.signed_payload(frame, self.anchor)

    def test_valid_signature_with_wrong_inner_domain_or_authority_refused(self):
        for field, value in [('trustDomain', 'production'), ('currentDeploymentAuthority', True)]:
            payload = {**self.payload, field: value};raw = json.dumps(payload).encode();frame = copy.deepcopy(self.frame)
            frame.update(payloadBase64=base64.b64encode(raw).decode(), payloadSha256=hashlib.sha256(raw).hexdigest(), payloadBytes=len(raw), signatureBase64=base64.b64encode(self.key.sign(raw)).decode())
            with self.subTest(field=field), self.assertRaises(ValueError):probe.signed_payload(frame, self.anchor)


if __name__ == '__main__':unittest.main()
