package dev.agenttrust.core;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
@RestController
public class AuthInfoController {
    private final String mode;
    private final String objectMode;
    private final String signingMode;
    public AuthInfoController(@Value("${agenttrust.identity-mode}") String mode,@Value("${agenttrust.object-mode}") String objectMode,@Value("${agenttrust.gate-signing-mode:disabled}") String signingMode){if(!java.util.List.of("keycloak","local-demo").contains(mode)||!java.util.List.of("minio","disabled").contains(objectMode))throw new IllegalStateException("Unsupported identity or storage configuration");this.mode=mode;this.objectMode=objectMode;if(!java.util.List.of("disabled","local-development").contains(signingMode))throw new IllegalStateException("Unsupported signing configuration");this.signingMode=signingMode;}
    @GetMapping("/api/auth-info") Map<String,String> info(){return Map.of("identityProvider",mode,"loginPath",mode.equals("keycloak")?"/backend/oauth2/authorization/keycloak":"/backend/login","objectStorage",objectMode,"gateSigning",signingMode);}
}
