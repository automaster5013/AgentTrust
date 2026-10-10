package dev.agenttrust.core;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
@RestController
public class AuthInfoController {
    private final String mode;
    public AuthInfoController(@Value("${agenttrust.identity-mode}") String mode){if(!java.util.List.of("keycloak","local-demo").contains(mode))throw new IllegalStateException("Unsupported identity configuration");this.mode=mode;}
    @GetMapping("/api/auth-info") Map<String,String> info(){return Map.of("identityProvider",mode,"loginPath",mode.equals("keycloak")?"/backend/oauth2/authorization/keycloak":"/backend/login");}
}
