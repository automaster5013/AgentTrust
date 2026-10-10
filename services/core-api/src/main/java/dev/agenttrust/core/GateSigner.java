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
    @org.springframework.beans.factory.annotation.Autowired
    public GateSigner(ObjectMapper mapper) throws Exception {
        Path path=Path.of("/run/secrets/stack-gate-key-pair");if(Files.size(path)>4096)throw new IllegalStateException("Development signing configuration unavailable");
        var value=mapper.readTree(Files.readString(path));if(value.size()!=3||!value.path("schemaVersion").isIntegralNumber()||value.path("schemaVersion").asInt()!=1)throw new IllegalStateException("Development signing configuration unavailable");
        var pair=load(value.path("privateKey").asText(),value.path("publicKey").asText());privateKey=pair.getPrivate();publicKey=pair.getPublic();keyId=ArchiveIntegrity.sha256(publicKey.getEncoded());
    }
    GateSigner(KeyPair pair) throws Exception {
        var checked=load(Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()),Base64.getEncoder().encodeToString(pair.getPublic().getEncoded()));privateKey=checked.getPrivate();publicKey=checked.getPublic();keyId=ArchiveIntegrity.sha256(publicKey.getEncoded());
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
    String sign(byte[] payload) throws Exception {
        ArchiveIntegrity.sha256(payload);var signature=Signature.getInstance("Ed25519");signature.initSign(privateKey);signature.update(payload);return Base64.getEncoder().encodeToString(signature.sign());
    }
    boolean verify(String id,byte[] payload,String encoded) {
        try{
            ArchiveIntegrity.sha256(payload);if(!keyId.equals(id)||encoded==null||!encoded.matches("[A-Za-z0-9+/]{86}=="))return false;
            byte[] bytes=Base64.getDecoder().decode(encoded);if(bytes.length!=64)return false;var signature=Signature.getInstance("Ed25519");signature.initVerify(publicKey);signature.update(payload);return signature.verify(bytes);
        }catch(Exception invalid){return false;}
    }
}
