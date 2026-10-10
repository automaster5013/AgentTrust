package dev.agenttrust.core;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import static org.junit.jupiter.api.Assertions.*;
class OidcWorkspaceUserTest {
    private Map<String,Object> claims(){return new HashMap<>(Map.of("sub","11111111-1111-4111-8111-111111111111","preferred_username","demo-editor","agenttrust_organization","22222222-2222-4222-8222-222222222222","agenttrust_project","33333333-3333-4333-8333-333333333333","agenttrust_roles",List.of("editor")));}
    private DefaultOidcUser user(Map<String,Object> claims){return new DefaultOidcUser(List.of(),new OidcIdToken("synthetic-unit-token",Instant.now(),Instant.now().plusSeconds(60),claims));}
    @Test void validatedPrincipalMapsRecordedScopeAndRole(){var domain=new OidcWorkspaceUser(user(claims()));assertEquals("editor",domain.role());assertEquals("demo-editor",domain.getUsername());assertEquals("22222222-2222-4222-8222-222222222222",domain.organizationId().toString());}
    @Test void missingScopeAndUnsupportedRolesAreRefused(){var missing=claims();missing.remove("agenttrust_project");assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(missing)));var malformed=claims();malformed.put("agenttrust_roles","admin");assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(malformed)));var unknown=claims();unknown.put("agenttrust_roles",List.of("realm-manager"));assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(unknown)));}
}
