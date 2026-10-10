package dev.agenttrust.core;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
@RestController
public class AuthInfoController {
    private final String mode;
    private final String objectMode;
    public AuthInfoController(@Value("${agenttrust.identity-mode}") String mode,@Value("${agenttrust.object-mode}") String objectMode){if(!java.util.List.of("keycloak","local-demo").contains(mode)||!java.util.List.of("minio","disabled").contains(objectMode))throw new IllegalStateException("Unsupported identity or storage configuration");this.mode=mode;this.objectMode=objectMode;}
    @GetMapping("/api/auth-info") Map<String,String> info(){return Map.of("identityProvider",mode,"loginPath",mode.equals("keycloak")?"/backend/oauth2/authorization/keycloak":"/backend/login","objectStorage",objectMode);}
}
