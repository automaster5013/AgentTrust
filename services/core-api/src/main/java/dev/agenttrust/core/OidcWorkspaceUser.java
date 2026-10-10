package dev.agenttrust.core;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.OidcUserInfo;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/** Domain scope is accepted only from the validated OIDC principal, never API input. */
public final class OidcWorkspaceUser extends DemoUser implements OidcUser {
    private final OidcUser source;
    public OidcWorkspaceUser(OidcUser source) {
        super(username(source),"not-stored",scope(source,"agenttrust_organization"),scope(source,"agenttrust_project"),scope(source,"sub"),role(source));this.source=source;
    }
    private static String username(OidcUser source){Object value=source.getClaims().get("preferred_username");if(!(value instanceof String name)||!name.matches("[a-z][a-z0-9-]{2,40}"))throw new IllegalArgumentException("Invalid OIDC account");return name;}
    private static UUID scope(OidcUser source,String field){Object value=source.getClaims().get(field);if(!(value instanceof String text))throw new IllegalArgumentException("Missing OIDC scope");UUID id=UUID.fromString(text);if(!id.toString().equals(text))throw new IllegalArgumentException("Invalid OIDC scope");return id;}
    private static String role(OidcUser source){Object value=source.getClaims().get("agenttrust_roles");if(!(value instanceof List<?> roles)||roles.stream().anyMatch(r->!(r instanceof String)))throw new IllegalArgumentException("Missing OIDC roles");return List.of("admin","editor","viewer").stream().filter(roles::contains).findFirst().orElseThrow(()->new IllegalArgumentException("Unsupported OIDC role"));}
    @Override public Map<String,Object> getClaims(){return source.getClaims();}
    @Override public Map<String,Object> getAttributes(){return source.getAttributes();}
    @Override public OidcUserInfo getUserInfo(){return source.getUserInfo();}
    @Override public OidcIdToken getIdToken(){return source.getIdToken();}
    @Override public String getName(){return source.getName();}
}
