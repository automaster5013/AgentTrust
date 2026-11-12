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
class EvaluationRecentControllerTest {
 @Test void authenticatedRouteReturnsProjectCountsAndRejectsWrites()throws Exception{
  var capacity=mock(EvaluationRecent.class);var mvc=MockMvcBuilders.standaloneSetup(new EvaluationRecentController(capacity)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  when(capacity.read(user)).thenReturn(new EvaluationRecent.Snapshot("project-evaluation-recent-v1","project",user.organizationId(),user.projectId(),Instant.parse("2026-11-11T00:00:00Z"),Instant.parse("2026-11-12T00:00:00Z"),10,2,3,false));
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));try{mvc.perform(get("/api/evaluation-recent")).andExpect(status().isOk()).andExpect(jsonPath("$.projectId").value(user.projectId().toString())).andExpect(jsonPath("$.completedCount").value(10)).andExpect(jsonPath("$.deploymentAuthority").value(false));mvc.perform(post("/api/evaluation-recent")).andExpect(status().isMethodNotAllowed());verify(capacity).read(user);verifyNoMoreInteractions(capacity);}finally{SecurityContextHolder.clearContext();}
 }
}
