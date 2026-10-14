package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class RunRequestResolutionTest {
 private final JdbcTemplate jdbc=mock(JdbcTemplate.class);private final UUID id=UUID.randomUUID();private final String key=UUID.randomUUID().toString();
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final RunService service=new RunService(jdbc,null,null,null){@Override <T>T scoped(DemoUser user,Supplier<T> action){return action.get();}};
 private final String query="SELECT id FROM stack_runs WHERE organization_id=? AND project_id=? AND actor_id=? AND idempotency_key=? LIMIT 2";
 @Test void existingAdmissionIsReadByOwnerAndNeverGrantsDeploymentAuthority(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id)));var value=service.resolveRequest(user,key);assertEquals(Map.of("requestKey",key,"organizationId",user.organizationId(),"projectId",user.projectId(),"actorId",user.actorId(),"runId",id,"deploymentAuthority",false),value);verify(jdbc).queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key);verifyNoMoreInteractions(jdbc);}
 @Test void invalidKeysFailBeforeAnyStorageRead(){for(String token:new String[]{null,"","short","a".repeat(101),"a/bbbbbbb","a%bbbbbb","a.bbbbbb","a bbbbbb","a\nbbbbbb"})assertThrows(IllegalArgumentException.class,()->service.resolveRequest(user,token));verifyNoInteractions(jdbc);}
 @Test void foreignScopeOrOwnerCannotSubstituteAdmission(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id)));for(DemoUser other:new DemoUser[]{new DemoUser("other","unused",UUID.randomUUID(),user.projectId(),user.actorId(),"admin"),new DemoUser("other","unused",user.organizationId(),UUID.randomUUID(),user.actorId(),"admin"),new DemoUser("other","unused",user.organizationId(),user.projectId(),UUID.randomUUID(),"admin")}){var error=assertThrows(ResponseStatusException.class,()->service.resolveRequest(other,key));assertEquals(404,error.getStatusCode().value());}}
 @Test void unknownKeysReturnNotFoundWithoutCreatingOrSubmittingEvaluation(){var error=assertThrows(ResponseStatusException.class,()->service.resolveRequest(user,key));assertEquals(404,error.getStatusCode().value());verify(jdbc).queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key);verifyNoMoreInteractions(jdbc);}
 @Test void ambiguousStorageCannotChooseAnUnrelatedEvaluation(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id),Map.of("id",UUID.randomUUID())));assertThrows(IllegalStateException.class,()->service.resolveRequest(user,key));}
 @Test void asciiBoundariesSupportExistingAdmissionKeyFormat(){for(String token:new String[]{"a".repeat(8),"a".repeat(100),"campaign_"+UUID.randomUUID().toString().replace("-","")+"_0",UUID.randomUUID().toString()})assertDoesNotThrow(()->RunRequestKey.validate(token));}
}
