package dev.agenttrust.core;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.Objects;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.OidcUserInfo;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/** Domain scope is accepted only from the validated OIDC principal, never API input. */
public final class OidcWorkspaceUser extends DemoUser implements OidcUser {
    private final OidcUser source;
    public OidcWorkspaceUser(OidcUser source) {
        this(source,identity(source));
    }
    private OidcWorkspaceUser(OidcUser source,Identity identity) {
        super(identity.username(),"not-stored",identity.organization(),identity.project(),identity.actor(),identity.role());
        this.source=source;
    }
    private record Identity(String username,UUID organization,UUID project,UUID actor,String role) {}
    private static Identity identity(OidcUser source) {
        if(source==null||source.getIdToken()==null)throw new IllegalArgumentException("Missing OIDC identity");
        // OidcUser.getClaims() merges token/UserInfo values. Domain authority is
        // instead bound to the validated ID token; optional UserInfo may not
        // contradict it or fill missing signed workspace claims.
        var token=source.getIdToken().getClaims();
        String username=username(token.get("preferred_username"));
        UUID organization=scope(token.get("agenttrust_organization"));
        UUID project=scope(token.get("agenttrust_project"));
        UUID actor=scope(token.get("sub"));
        Set<String> roles=roles(token.get("agenttrust_roles"));
        String role=List.of("admin","editor","viewer").stream().filter(roles::contains).findFirst()
            .orElseThrow(()->new IllegalArgumentException("Unsupported OIDC role"));
        if(source.getUserInfo()!=null) {
            var info=source.getUserInfo().getClaims();
            if(!Objects.equals(info.get("sub"),token.get("sub")))throw new IllegalArgumentException("Conflicting OIDC identity");
            for(String field:List.of("preferred_username","agenttrust_organization","agenttrust_project")) {
                if(info.containsKey(field)&&!Objects.equals(info.get(field),token.get(field)))
                    throw new IllegalArgumentException("Conflicting OIDC identity");
            }
            if(info.containsKey("agenttrust_roles")&&!roles.equals(roles(info.get("agenttrust_roles"))))
                throw new IllegalArgumentException("Conflicting OIDC roles");
        }
        return new Identity(username,organization,project,actor,role);
    }
    private static String username(Object value){if(!(value instanceof String name)||!name.matches("[a-z][a-z0-9-]{2,40}"))throw new IllegalArgumentException("Invalid OIDC account");return name;}
    private static UUID scope(Object value){if(!(value instanceof String text))throw new IllegalArgumentException("Missing OIDC scope");UUID id=UUID.fromString(text);if(!id.toString().equals(text)||id.equals(new UUID(0,0)))throw new IllegalArgumentException("Invalid OIDC scope");return id;}
    private static Set<String> roles(Object value){if(!(value instanceof List<?> roles)||roles.stream().anyMatch(r->!(r instanceof String)))throw new IllegalArgumentException("Missing OIDC roles");return Set.copyOf(roles.stream().map(String.class::cast).toList());}
    @Override public Map<String,Object> getClaims(){return source.getClaims();}
    @Override public Map<String,Object> getAttributes(){return source.getAttributes();}
    @Override public OidcUserInfo getUserInfo(){return source.getUserInfo();}
    @Override public OidcIdToken getIdToken(){return source.getIdToken();}
    @Override public String getName(){return source.getName();}
}
