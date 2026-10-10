package dev.agenttrust.core;
import java.util.Map;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class ProviderBudgetTest {
 private final RunService runs=mock(RunService.class);private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
 private final UUID id=UUID.randomUUID();private final DemoUser user=new DemoUser("budget","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
 @SuppressWarnings("unchecked") private ProviderBudget fixture(String provider,long duplicate,long count,boolean expired){
  when(runs.scoped(eq(user),any())).thenAnswer(invocation->((Supplier<Object>)invocation.getArgument(1)).get());
  when(jdbc.queryForList(anyString(),eq(id),eq(user.organizationId()),eq(user.projectId()))).thenReturn(List.of(Map.of("scenario","pass","provider",provider,"state","queued","expired",expired)));
  when(jdbc.queryForObject("SELECT count(*) FROM stack_provider_attempts WHERE run_id=?",Long.class,id)).thenReturn(duplicate);
  when(jdbc.queryForObject("SELECT count(*) FROM stack_provider_attempts WHERE organization_id=? AND project_id=? AND budget_day=(now() AT TIME ZONE 'UTC')::date",Long.class,user.organizationId(),user.projectId())).thenReturn(count);
  return new ProviderBudget(runs,jdbc);
 }
 @Test void singleReservationHasBoundedTokens(){var service=fixture("ollama",0,99,false);var response=service.reserve(user,id,"pass","ollama");assertEquals(true,response.get("allowed"));assertEquals(256,response.get("reservedInputTokens"));assertEquals(128,response.get("reservedOutputTokens"));verify(jdbc).update(anyString(),eq(id),eq(user.organizationId()),eq(user.projectId()),eq("ollama"));}
 @Test void exhaustedBudgetDuplicateAndExpiredAreNotReissued(){for(int mode=0;mode<3;mode++){reset(runs,jdbc);var service=fixture("ollama",mode==0?1:0,mode==1?100:0,mode==2);assertEquals(false,service.reserve(user,id,"pass","ollama").get("allowed"));verify(jdbc,never()).update(anyString(),any(),any(),any(),any());}}
 @Test void providerOrScenarioCannotBeChanged(){var service=fixture("ollama",0,0,false);assertThrows(ResponseStatusException.class,()->service.reserve(user,id,"pass","openai"));assertThrows(ResponseStatusException.class,()->service.reserve(user,id,"block","ollama"));verify(jdbc,never()).update(anyString(),any(),any(),any(),any());}
}
