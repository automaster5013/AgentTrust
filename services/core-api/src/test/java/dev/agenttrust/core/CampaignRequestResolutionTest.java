package dev.agenttrust.core;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CampaignRequestResolutionTest {
 private final JdbcTemplate jdbc=mock(JdbcTemplate.class);private final RunService runs=mock(RunService.class);private final UUID id=UUID.randomUUID();private final String key=UUID.randomUUID().toString();
 private final DemoUser user=new DemoUser("viewer","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 private final CampaignService service=new CampaignService(runs,null,jdbc,null,null,null);
 private final String query="SELECT id FROM stack_campaigns WHERE organization_id=? AND project_id=? AND actor_id=? AND idempotency_key=? LIMIT 2";
 CampaignRequestResolutionTest(){when(runs.scoped(any(),any())).thenAnswer(call->((Supplier<?>)call.getArgument(1)).get());}
 @Test void existingCampaignIsReadOnlyAndBoundToExactOwnerScopeAndKey(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id)));assertEquals(Map.of("requestKey",key,"organizationId",user.organizationId(),"projectId",user.projectId(),"actorId",user.actorId(),"campaignId",id,"deploymentAuthority",false),service.resolveRequest(user,key));verify(jdbc).queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key);verifyNoMoreInteractions(jdbc);}
 @Test void malformedKeysNeverReadStorage(){for(String token:new String[]{null,"","short","a".repeat(101),"a/bbbbbbb","a%bbbbbb","a.bbbbbb","a bbbbbb","a\nbbbbbb"})assertThrows(IllegalArgumentException.class,()->service.resolveRequest(user,token));verifyNoInteractions(jdbc);}
 @Test void changingActorOrganizationOrProjectCannotDiscoverAnotherAdmission(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id)));for(DemoUser other:new DemoUser[]{new DemoUser("other","unused",UUID.randomUUID(),user.projectId(),user.actorId(),"admin"),new DemoUser("other","unused",user.organizationId(),UUID.randomUUID(),user.actorId(),"admin"),new DemoUser("other","unused",user.organizationId(),user.projectId(),UUID.randomUUID(),"admin")})assertEquals(404,assertThrows(ResponseStatusException.class,()->service.resolveRequest(other,key)).getStatusCode().value());}
 @Test void unknownKeyNeverCreatesOrResubmitsCampaign(){assertEquals(404,assertThrows(ResponseStatusException.class,()->service.resolveRequest(user,key)).getStatusCode().value());verify(jdbc).queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key);verifyNoMoreInteractions(jdbc);}
 @Test void ambiguousStorageNeverPicksAnArbitraryCampaign(){when(jdbc.queryForList(query,user.organizationId(),user.projectId(),user.actorId(),key)).thenReturn(List.of(Map.of("id",id),Map.of("id",UUID.randomUUID())));assertThrows(IllegalStateException.class,()->service.resolveRequest(user,key));}
}
