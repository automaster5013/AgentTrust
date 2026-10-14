package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Development signing only. A signed observation never grants current deployment authority. */
@Component
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class GateSigner {
    public static final String TRUST_DOMAIN="agenttrust-local-development";
    private final PrivateKey privateKey;
    private final PublicKey publicKey;
    private final String keyId;
    private final Map<String,GatePublicKeys.Entry> historical;
    @org.springframework.beans.factory.annotation.Autowired
    public GateSigner(ObjectMapper mapper,org.springframework.core.env.Environment environment) throws Exception {
        var pair=configurationPair(mapper,readBounded(Path.of("/run/secrets/stack-gate-key-pair"),4096));privateKey=pair.getPrivate();publicKey=pair.getPublic();keyId=ArchiveIntegrity.sha256(publicKey.getEncoded());
        String archive=environment.getProperty("agenttrust.gate-retired-keys-file","");
        if(!archive.isEmpty()&&!archive.equals("/run/secrets/stack-gate-retired-keys"))throw new IllegalArgumentException("Historical signing configuration unavailable");
        historical=archive.isEmpty()?Map.of():GatePublicKeys.parse(readBounded(Path.of(archive),GatePublicKeys.MAX_BYTES),keyId);
    }
    GateSigner(KeyPair pair) throws Exception {
        this(pair,Map.of());
    }
    GateSigner(KeyPair pair,String archive) throws Exception {
        this(pair,GatePublicKeys.parse(archive,ArchiveIntegrity.sha256(pair.getPublic().getEncoded())));
    }
    private GateSigner(KeyPair pair,Map<String,GatePublicKeys.Entry> history) throws Exception {
        var checked=load(Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()),Base64.getEncoder().encodeToString(pair.getPublic().getEncoded()));privateKey=checked.getPrivate();publicKey=checked.getPublic();keyId=ArchiveIntegrity.sha256(publicKey.getEncoded());
        historical=Map.copyOf(history);
    }
    static String readBounded(Path path,int maximum) throws Exception {
        if(!Files.isRegularFile(path))throw new IllegalArgumentException("Signing configuration unavailable");
        try(var stream=Files.newInputStream(path)){
            byte[] bytes=stream.readNBytes(maximum+1);if(bytes.length==0||bytes.length>maximum)throw new IllegalArgumentException("Signing configuration unavailable");
            return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        }
    }
    static KeyPair configurationPair(ObjectMapper mapper,String json) {
        try {
            if(json==null||json.getBytes(StandardCharsets.UTF_8).length>4096)throw new IllegalArgumentException();
            var strict=mapper.copy().enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
            var value=strict.readTree(json);
            if(value==null||!value.isObject()||value.size()!=3||!value.path("schemaVersion").isIntegralNumber()||!value.path("schemaVersion").canConvertToInt()||value.path("schemaVersion").intValue()!=1||!value.path("privateKey").isTextual()||!value.path("publicKey").isTextual())throw new IllegalArgumentException();
            return load(value.path("privateKey").textValue(),value.path("publicKey").textValue());
        }catch(Exception invalid){throw new IllegalStateException("Development signing configuration unavailable");}
    }
    static KeyPair load(String privateEncoded,String publicEncoded) throws Exception {
        byte[] privateBytes=Base64.getDecoder().decode(privateEncoded),publicBytes=Base64.getDecoder().decode(publicEncoded);
        if(privateBytes.length!=48||publicBytes.length!=44||!Base64.getEncoder().encodeToString(privateBytes).equals(privateEncoded)||!Base64.getEncoder().encodeToString(publicBytes).equals(publicEncoded))throw new IllegalArgumentException("Invalid development signing keys");
        var factory=KeyFactory.getInstance("Ed25519");var privateKey=factory.generatePrivate(new PKCS8EncodedKeySpec(privateBytes));var publicKey=factory.generatePublic(new X509EncodedKeySpec(publicBytes));
        if(!Arrays.equals(privateKey.getEncoded(),privateBytes)||!Arrays.equals(publicKey.getEncoded(),publicBytes))throw new IllegalArgumentException("Invalid development signing encoding");
        var signature=Signature.getInstance("Ed25519");byte[] message="AgentTrust development key pair consistency/v1".getBytes(StandardCharsets.UTF_8);signature.initSign(privateKey);signature.update(message);byte[] proof=signature.sign();signature.initVerify(publicKey);signature.update(message);if(!signature.verify(proof))throw new IllegalArgumentException("Development signing keys disagree");return new KeyPair(publicKey,privateKey);
    }
    String keyId(){return keyId;}
    Map<String,Object> trust(){return Map.of("keyId",keyId,"publicKeySpkiBase64",Base64.getEncoder().encodeToString(publicKey.getEncoded()),"signatureAlgorithm","Ed25519","trustDomain",TRUST_DOMAIN,"productionKey",false);}
    Map<String,Object> trust(String id){
        if(keyId.equals(id))return trust();
        var entry=historical.get(id);if(entry==null||entry.revoked())return null;
        return Map.of("keyId",id,"publicKeySpkiBase64",Base64.getEncoder().encodeToString(entry.publicKey().getEncoded()),"signatureAlgorithm","Ed25519","trustDomain",TRUST_DOMAIN,"productionKey",false);
    }
    String sign(byte[] payload) throws Exception {
        ArchiveIntegrity.sha256(payload);var signature=Signature.getInstance("Ed25519");signature.initSign(privateKey);signature.update(payload);return Base64.getEncoder().encodeToString(signature.sign());
    }
    boolean verify(String id,byte[] payload,String encoded) {
        try{
            ArchiveIntegrity.sha256(payload);if(encoded==null||!encoded.matches("[A-Za-z0-9+/]{86}=="))return false;
            var old=historical.get(id);PublicKey key=keyId.equals(id)?publicKey:old==null||old.revoked()?null:old.publicKey();if(key==null)return false;
            byte[] bytes=Base64.getDecoder().decode(encoded);if(bytes.length!=64||!Base64.getEncoder().encodeToString(bytes).equals(encoded))return false;var signature=Signature.getInstance("Ed25519");signature.initVerify(key);signature.update(payload);return signature.verify(bytes);
        }catch(Exception invalid){return false;}
    }
}
