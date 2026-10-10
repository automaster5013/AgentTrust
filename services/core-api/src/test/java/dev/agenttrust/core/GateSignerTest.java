package dev.agenttrust.core;
import java.security.KeyPairGenerator;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class GateSignerTest {
 @Test void actualEd25519SignatureBindsBytesAndTrustedKey() throws Exception {
  var signer=new GateSigner(KeyPairGenerator.getInstance("Ed25519").generateKeyPair());byte[] bytes="historical observation".getBytes(StandardCharsets.UTF_8);String signature=signer.sign(bytes);
  assertTrue(signer.verify(signer.keyId(),bytes,signature));assertFalse(signer.verify(signer.keyId(),"changed".getBytes(StandardCharsets.UTF_8),signature));assertFalse(signer.verify("a".repeat(64),bytes,signature));assertFalse(signer.verify(signer.keyId(),bytes,"not-a-signature"));
 }
 @Test void mismatchedPrivateAndPublicKeysAreRejected() throws Exception {
  var generator=KeyPairGenerator.getInstance("Ed25519");var first=generator.generateKeyPair();var second=generator.generateKeyPair();
  assertThrows(IllegalArgumentException.class,()->GateSigner.load(Base64.getEncoder().encodeToString(first.getPrivate().getEncoded()),Base64.getEncoder().encodeToString(second.getPublic().getEncoded())));
 }
 @Test void publishedTrustContainsOnlyDevelopmentPublicMaterial() throws Exception {
  var signer=new GateSigner(KeyPairGenerator.getInstance("Ed25519").generateKeyPair());var trust=signer.trust();assertEquals(5,trust.size());assertEquals(false,trust.get("productionKey"));assertEquals(GateSigner.TRUST_DOMAIN,trust.get("trustDomain"));assertEquals(signer.keyId(),ArchiveIntegrity.sha256(Base64.getDecoder().decode((String)trust.get("publicKeySpkiBase64"))));
 }
}
