package dev.agenttrust.core;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.OidcUserInfo;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import static org.junit.jupiter.api.Assertions.*;
class OidcWorkspaceUserTest {
    private Map<String,Object> claims(){return new HashMap<>(Map.of("sub","11111111-1111-4111-8111-111111111111","preferred_username","demo-editor","agenttrust_organization","22222222-2222-4222-8222-222222222222","agenttrust_project","33333333-3333-4333-8333-333333333333","agenttrust_roles",List.of("editor")));}
    private DefaultOidcUser user(Map<String,Object> claims){return new DefaultOidcUser(List.of(),new OidcIdToken("synthetic-unit-token",Instant.now(),Instant.now().plusSeconds(60),claims));}
    private DefaultOidcUser user(Map<String,Object> claims,Map<String,Object> info){return new DefaultOidcUser(List.of(),new OidcIdToken("synthetic-unit-token",Instant.now(),Instant.now().plusSeconds(60),claims),new OidcUserInfo(info));}
    @Test void validatedPrincipalMapsRecordedScopeAndRole(){var domain=new OidcWorkspaceUser(user(claims()));assertEquals("editor",domain.role());assertEquals("demo-editor",domain.getUsername());assertEquals("22222222-2222-4222-8222-222222222222",domain.organizationId().toString());}
    @Test void missingScopeAndUnsupportedRolesAreRefused(){var missing=claims();missing.remove("agenttrust_project");assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(missing)));var malformed=claims();malformed.put("agenttrust_roles","admin");assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(malformed)));var unknown=claims();unknown.put("agenttrust_roles",List.of("realm-manager"));assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(unknown)));}
    @Test void nilOrganizationProjectAndActorAreRefused(){
        for(String field:List.of("sub","agenttrust_organization","agenttrust_project")){
            var token=claims();token.put(field,"00000000-0000-0000-0000-000000000000");
            assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(token)));
        }
    }
    @Test void userInfoCannotSupplyMissingSignedWorkspaceClaims(){
        for(String field:List.of("preferred_username","agenttrust_organization","agenttrust_project","agenttrust_roles")){
            var token=claims();token.remove(field);
            assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(token,claims())));
        }
    }
    @Test void conflictingUserInfoScopeNameSubjectOrRolesAreRefused(){
        for(String field:List.of("sub","preferred_username","agenttrust_organization","agenttrust_project","agenttrust_roles")){
            var info=claims();
            info.put(field,field.equals("agenttrust_roles")?List.of("admin"):field.equals("preferred_username")?"other-admin":"44444444-4444-4444-8444-444444444444");
            assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(claims(),info)));
        }
    }
    @Test void limitedUserInfoAndReorderedEquivalentRolesRemainUsable(){
        assertEquals("editor",new OidcWorkspaceUser(user(claims(),Map.of("sub",claims().get("sub")))).role());
        var token=claims();var info=claims();token.put("agenttrust_roles",List.of("default-roles-agenttrust","editor"));info.put("agenttrust_roles",List.of("editor","default-roles-agenttrust"));
        var domain=new OidcWorkspaceUser(user(token,info));
        assertEquals("editor",domain.role());assertEquals(claims().get("agenttrust_project"),domain.projectId().toString());
    }
    @Test void malformedUserInfoRoleTypesAndNullPrincipalAreRefused(){
        var info=claims();info.put("agenttrust_roles","editor");
        assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(user(claims(),info)));
        assertThrows(IllegalArgumentException.class,()->new OidcWorkspaceUser(null));
    }
}
