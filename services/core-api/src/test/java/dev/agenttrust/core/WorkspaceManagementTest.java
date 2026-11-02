package dev.agenttrust.core;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
class WorkspaceManagementTest {
 @Test void numericIntentCannotBeCoercedFromTextBooleanFractionOrOverflow()throws Exception{var mapper=new com.fasterxml.jackson.databind.ObjectMapper();assertEquals(1,WorkspaceManagementController.number(mapper.readTree("1"),1,30));for(String input:new String[]{"\"1\"","true","1.5","null","31","9223372036854775808"})assertThrows(ResponseStatusException.class,()->WorkspaceManagementController.number(mapper.readTree(input),1,30));}
 static DemoUser user(String role){return new DemoUser("test","unused",UUID.fromString("11111111-1111-4111-8111-111111111111"),UUID.fromString("22222222-2222-4222-8222-222222222222"),UUID.randomUUID(),role);}
 static class Fixture {
  final RunService runs=mock(RunService.class);final JdbcTemplate jdbc;final WorkspaceManagement service;
  final Instant now=Instant.parse("2026-10-31T00:00:00Z");long revision;String name="",description="",hash;UUID keyId,keyOrganization,keyProject;boolean revoked;int mutations;DemoUser scope;
  @SuppressWarnings("unchecked") Fixture(){
   doAnswer(call->{scope=call.getArgument(0);return ((Supplier<Object>)call.getArgument(1)).get();}).when(runs).scoped(any(),any());
   jdbc=mock(JdbcTemplate.class,call->{String method=call.getMethod().getName();if(method.equals("toString"))return "synthetic-jdbc";Object[] args=call.getArguments();String sql=(String)args[0];
    if(method.equals("queryForObject")){if(sql.startsWith("SELECT now"))return Timestamp.from(now);if(sql.contains("advisory"))return true;if(sql.contains("count(*)"))return 0;}
    if(method.equals("update")){mutations++;if(sql.startsWith("INSERT INTO stack_project_settings")){revision=((Number)args[3]).longValue();name=(String)args[5];description=(String)args[6];}else if(sql.startsWith("INSERT INTO stack_access_keys")){keyId=(UUID)args[1];keyOrganization=(UUID)args[2];keyProject=(UUID)args[3];hash=(String)args[6];}else if(sql.startsWith("INSERT INTO stack_access_key_revocations"))revoked=true;return 1;}
    if(method.equals("query")){if(sql.startsWith("SELECT revision"))return revision==0?List.of():List.of(new WorkspaceManagement.Project(scope.organizationId(),scope.projectId(),revision,name,description,now,false));if(sql.startsWith("SELECT k.secret_hash"))return revoked||hash==null||(!Objects.equals(args[2],keyId)||!Objects.equals(args[3],keyOrganization)||!Objects.equals(args[4],keyProject))?List.of():List.of(hash);if(sql.startsWith("SELECT k.id"))return List.of();}
    throw new AssertionError("Unexpected synthetic JDBC operation");});service=new WorkspaceManagement(runs,jdbc);
  }
 }
 @Test void projectUsesScopeAndRevisionWithoutChangingMembership(){var f=new Fixture();var owner=user("admin");assertEquals(0,f.service.project(owner).revision());var result=f.service.update(owner,0,"  Team  ","Description");assertEquals("Team",result.name());assertEquals(owner.projectId(),result.projectId());assertEquals(1,result.revision());assertFalse(result.deploymentAuthority());assertThrows(ResponseStatusException.class,()->f.service.update(owner,0,"stale",""));assertEquals(1,f.mutations);verify(f.runs).audit(owner,"workspace.project.updated",owner.projectId());}
 @Test void nonAdminCannotMutateOrListKeysBeforeDatabaseAccess(){var f=new Fixture();var viewer=user("viewer");assertThrows(ResponseStatusException.class,()->f.service.update(viewer,0,"name",""));assertThrows(ResponseStatusException.class,()->f.service.issue(viewer,UUID.randomUUID(),"name",1));assertThrows(ResponseStatusException.class,()->f.service.keys(viewer));assertThrows(ResponseStatusException.class,()->f.service.revoke(viewer,UUID.randomUUID()));verifyNoInteractions(f.jdbc);}
 @Test void issuedKeyStoresOnlyHashAndWorksOnlyAsScopedMetadataRead(){var f=new Fixture();var owner=user("admin");UUID id=UUID.randomUUID();var issued=f.service.issue(owner,id,"test",1);var parsed=WorkspaceManagement.token("Bearer "+issued.token());assertEquals(64,parsed.secret().length());assertEquals(WorkspaceManagement.hash(parsed.secret()),f.hash);assertFalse(issued.toString().contains(parsed.secret()));assertFalse(parsed.toString().contains(parsed.secret()));var project=f.service.projectWithKey("Bearer "+issued.token());assertEquals(owner.projectId(),project.projectId());assertEquals("viewer",f.scope.role());assertFalse(project.deploymentAuthority());assertThrows(ResponseStatusException.class,()->f.service.projectWithKey("Bearer "+issued.token().replace(owner.organizationId().toString(),UUID.randomUUID().toString())));f.revoked=true;assertThrows(ResponseStatusException.class,()->f.service.projectWithKey("Bearer "+issued.token()));}
 @Test void invalidSecretOrIdIsNeverAccepted(){var f=new Fixture();var issued=f.service.issue(user("admin"),UUID.randomUUID(),"test",7);assertThrows(ResponseStatusException.class,()->f.service.projectWithKey("Bearer "+issued.token().substring(0,issued.token().length()-64)+"0".repeat(64)));assertThrows(ResponseStatusException.class,()->f.service.projectWithKey("Bearer "+issued.token().replace(f.keyId.toString(),UUID.randomUUID().toString())));}
 @Test void malformedHeadersAndUnsafeInputsAreRefused(){for(String value:new String[]{"", "Bearer token", "Basic secret", "Bearer at1.x.x.x."+"a".repeat(64),"Bearer "+"x".repeat(300)})assertThrows(ResponseStatusException.class,()->WorkspaceManagement.token(value));var f=new Fixture();for(String label:new String[]{"", " ", "name\nnext", "x".repeat(81)})assertThrows(ResponseStatusException.class,()->f.service.update(user("admin"),0,label,""));assertThrows(ResponseStatusException.class,()->f.service.issue(user("admin"),UUID.randomUUID(),"test",31));assertEquals(0,f.mutations);}
}
