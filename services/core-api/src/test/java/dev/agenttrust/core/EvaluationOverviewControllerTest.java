package dev.agenttrust.core;
import java.util.UUID;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class EvaluationOverviewControllerTest {
 @Test void authenticatedRouteReturnsProjectCountsAndRejectsWrites()throws Exception{
  var capacity=mock(EvaluationOverview.class);var mvc=MockMvcBuilders.standaloneSetup(new EvaluationOverviewController(capacity)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  when(capacity.read(user)).thenReturn(new EvaluationOverview.Snapshot("project-evaluation-overview-v1","project",user.organizationId(),user.projectId(),Instant.now(),70,new EvaluationOverview.States(3,65,2),new EvaluationOverview.Decisions(40,20,10),false));
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));try{mvc.perform(get("/api/evaluation-overview")).andExpect(status().isOk()).andExpect(jsonPath("$.projectId").value(user.projectId().toString())).andExpect(jsonPath("$.retainedCount").value(70)).andExpect(jsonPath("$.deploymentAuthority").value(false));mvc.perform(post("/api/evaluation-overview")).andExpect(status().isMethodNotAllowed());verify(capacity).read(user);verifyNoMoreInteractions(capacity);}finally{SecurityContextHolder.clearContext();}
 }
}
