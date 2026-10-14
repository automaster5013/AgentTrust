package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class GatePublicKeysTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private KeyPair pair() throws Exception{return KeyPairGenerator.getInstance("Ed25519").generateKeyPair();}
    private String id(KeyPair pair){return ArchiveIntegrity.sha256(pair.getPublic().getEncoded());}
    private Map<String,Object> entry(KeyPair pair,String status){return Map.of("keyId",id(pair),"publicKeySpkiBase64",Base64.getEncoder().encodeToString(pair.getPublic().getEncoded()),"status",status);}
    private String archive(List<?> keys) throws Exception{return mapper.writeValueAsString(Map.of("schemaVersion",1,"keys",keys));}

    @Test void rotationKeepsHistoricalVerificationButSignsOnlyWithTheNewPrivateKey() throws Exception {
        var first=pair();var second=pair();var old=new GateSigner(first);var rotated=new GateSigner(second,archive(List.of(entry(first,"retired"))));
        byte[] before="pre-rotation observation".getBytes(java.nio.charset.StandardCharsets.UTF_8),after="new current observation".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var signature=old.sign(before);assertTrue(rotated.verify(old.keyId(),before,signature));
        assertFalse(rotated.verify(old.keyId(),after,signature));
        var current=rotated.sign(after);assertTrue(rotated.verify(rotated.keyId(),after,current));assertFalse(old.verify(old.keyId(),after,current));
        assertEquals(old.trust(),rotated.trust(old.keyId()));assertEquals(rotated.trust(),rotated.trust(rotated.keyId()));assertNotEquals(old.keyId(),rotated.keyId());
        assertEquals(5,rotated.trust(old.keyId()).size());assertFalse(rotated.trust(old.keyId()).containsKey("privateKey"));
    }
    @Test void revokedKeyCannotVerifyOrBePublishedWhileCurrentSigningRemainsAvailable() throws Exception {
        var first=pair();var old=new GateSigner(first);var active=pair();var signer=new GateSigner(active,archive(List.of(entry(first,"revoked"))));byte[] bytes={1,2,3};
        assertFalse(signer.verify(old.keyId(),bytes,old.sign(bytes)));assertNull(signer.trust(old.keyId()));
        assertTrue(signer.verify(signer.keyId(),bytes,signer.sign(bytes)));assertNull(signer.trust("a".repeat(64)));
    }
    @Test void noncanonicalSignatureEncodingCannotReuseTheSameDecodedSignature() throws Exception {
        var signer=new GateSigner(pair());byte[] bytes={1,2,3};String signature=signer.sign(bytes),alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        int index=alphabet.indexOf(signature.charAt(85));String alternate=signature.substring(0,85)+alphabet.charAt(index+1)+"==";
        assertArrayEquals(Base64.getDecoder().decode(signature),Base64.getDecoder().decode(alternate));
        assertTrue(signer.verify(signer.keyId(),bytes,signature));assertFalse(signer.verify(signer.keyId(),bytes,alternate));
    }
    @Test void unknownDuplicateActiveAndPrivateKeyEntriesAreRefused() throws Exception {
        var active=pair();var old=pair();var valid=entry(old,"retired");
        for(var keys:List.of(List.of(valid,valid),List.of(entry(active,"retired")),List.of(entry(old,"active")),List.of(Map.of("keyId",id(old),"privateKey","never-accepted","status","retired"))))
            assertThrows(IllegalArgumentException.class,()->GatePublicKeys.parse(archive(keys),id(active)));
    }
    @Test void publicKeyFingerprintAndCanonicalEd25519EncodingAreRequired() throws Exception {
        var active=pair();var old=pair();var good=entry(old,"retired");
        for(var bad:List.of(Map.of("keyId","f".repeat(64),"publicKeySpkiBase64",good.get("publicKeySpkiBase64"),"status","retired"),
            Map.of("keyId",id(old),"publicKeySpkiBase64",good.get("publicKeySpkiBase64")+"\n","status","retired"),
            Map.of("keyId",ArchiveIntegrity.sha256(new byte[44]),"publicKeySpkiBase64",Base64.getEncoder().encodeToString(new byte[44]),"status","retired")))
            assertThrows(IllegalArgumentException.class,()->GatePublicKeys.parse(archive(List.of(bad)),id(active)));
    }
    @Test void duplicateJsonFieldsTrailingDocumentsScalarCoercionsAndOversizeFailClosed() throws Exception {
        var active=pair();
        for(String bad:List.of("{\"schemaVersion\":1,\"schemaVersion\":1,\"keys\":[]}","{\"schemaVersion\":1,\"keys\":[]} {}",
            "{\"schemaVersion\":4294967297,\"keys\":[]}","{\"schemaVersion\":true,\"keys\":[]}","{\"schemaVersion\":1,\"keys\":[],\"extra\":true}"," ".repeat(8193)))
            assertThrows(IllegalArgumentException.class,()->GatePublicKeys.parse(bad,id(active)));
    }
    @Test void publicHistoryIsBoundedAndCanBeExplicitlyEmpty() throws Exception {
        var active=pair();assertTrue(GatePublicKeys.parse(archive(List.of()),id(active)).isEmpty());
        var keys=new ArrayList<Map<String,Object>>();for(int i=0;i<17;i++)keys.add(entry(pair(),"retired"));
        assertThrows(IllegalArgumentException.class,()->GatePublicKeys.parse(archive(keys),id(active)));
    }
    @Test void boundedReaderRejectsMissingEmptyAndGrowingBeyondTheLimit(@TempDir Path directory) throws Exception {
        Path file=directory.resolve("configuration");assertThrows(IllegalArgumentException.class,()->GateSigner.readBounded(file,8));
        Files.write(file,new byte[0]);assertThrows(IllegalArgumentException.class,()->GateSigner.readBounded(file,8));
        Files.writeString(file,"123456789");assertThrows(IllegalArgumentException.class,()->GateSigner.readBounded(file,8));
        Files.writeString(file,"12345678");assertEquals("12345678",GateSigner.readBounded(file,8));
        Files.write(file,new byte[]{(byte)0xff});assertThrows(java.nio.charset.CharacterCodingException.class,()->GateSigner.readBounded(file,8));
    }
    @Test void privateConfigurationParsingIsStrictAndNeverExposesInputOrParserCause() throws Exception {
        var pair=pair();String json=mapper.writeValueAsString(Map.of("schemaVersion",1,"privateKey",Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()),"publicKey",Base64.getEncoder().encodeToString(pair.getPublic().getEncoded())));
        assertArrayEquals(pair.getPublic().getEncoded(),GateSigner.configurationPair(mapper,json).getPublic().getEncoded());
        for(String invalid:List.of(json+" {}",json.replace("\"schemaVersion\":1","\"schemaVersion\":4294967297"),
            "{\"schemaVersion\":1,\"privateKey\":\"fixture-private-do-not-log\",\"privateKey\":\"duplicate\",\"publicKey\":\"invalid\"}","fixture-private-do-not-log","s".repeat(4097))) {
            var failure=assertThrows(IllegalStateException.class,()->GateSigner.configurationPair(mapper,invalid));
            assertEquals("Development signing configuration unavailable",failure.getMessage());assertNull(failure.getCause());
        }
    }
}
