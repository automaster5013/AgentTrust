package dev.agenttrust.core;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** Operator-owned public history only; it can never supply a signing private key. */
final class GatePublicKeys {
    record Entry(PublicKey publicKey, boolean revoked) {}
    static final int MAX_BYTES=8192;
    private GatePublicKeys() {}

    static Map<String,Entry> parse(String json,String activeId) {
        try {
            if(json==null||json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>MAX_BYTES)
                throw invalid();
            var mapper=new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
            var value=mapper.readTree(json);
            if(value==null||!value.isObject()||value.size()!=2
                ||!value.has("schemaVersion")||!value.path("schemaVersion").isIntegralNumber()
                ||!value.path("schemaVersion").canConvertToInt()||value.path("schemaVersion").intValue()!=1
                ||!value.path("keys").isArray()||value.path("keys").size()>16)throw invalid();
            var result=new HashMap<String,Entry>();
            for(var item:value.path("keys")) {
                if(!item.isObject()||item.size()!=3||!item.path("keyId").isTextual()
                    ||!item.path("publicKeySpkiBase64").isTextual()||!item.path("status").isTextual())throw invalid();
                String id=item.path("keyId").textValue(),encoded=item.path("publicKeySpkiBase64").textValue(),status=item.path("status").textValue();
                if(!id.matches("[a-f0-9]{64}")||id.equals(activeId)||result.containsKey(id)
                    ||!Set.of("retired","revoked").contains(status)||encoded.length()!=60)throw invalid();
                byte[] bytes=Base64.getDecoder().decode(encoded);
                if(bytes.length!=44||!Base64.getEncoder().encodeToString(bytes).equals(encoded)
                    ||!ArchiveIntegrity.sha256(bytes).equals(id))throw invalid();
                var key=KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(bytes));
                if(!Arrays.equals(key.getEncoded(),bytes))throw invalid();
                result.put(id,new Entry(key,"revoked".equals(status)));
            }
            return Map.copyOf(result);
        }catch(Exception unavailable){throw invalid();}
    }
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Historical signing configuration unavailable");}
}
