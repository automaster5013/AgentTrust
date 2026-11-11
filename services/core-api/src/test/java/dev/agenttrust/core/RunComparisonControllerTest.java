package dev.agenttrust.core;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class RunComparisonControllerTest {
 @Test void readOnlyHttpRouteForwardsAuthenticatedScopeAndRefusesMalformedIdsAndWrites()throws Exception{
  var service=mock(RunComparison.class);UUID a=UUID.randomUUID(),b=UUID.randomUUID();
  var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  when(service.compare(user,a,b)).thenReturn(Map.of("deploymentAuthority",false));
  var mvc=MockMvcBuilders.standaloneSetup(new RunComparisonController(service)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));
  try{
   String path="/api/runs/"+a+"/comparison/"+b;
   mvc.perform(get(path)).andExpect(status().isOk()).andExpect(jsonPath("$.deploymentAuthority").value(false));verify(service).compare(user,a,b);
   mvc.perform(post(path)).andExpect(status().isMethodNotAllowed());mvc.perform(get("/api/runs/bad/comparison/"+b)).andExpect(status().isBadRequest());verifyNoMoreInteractions(service);
  }finally{SecurityContextHolder.clearContext();}
 }
 @Test void anonymousRequestIsRejectedWithoutReadingRecords()throws Exception{
  var runs=mock(RunService.class);
  var mvc=MockMvcBuilders.standaloneSetup(new RunComparisonController(new RunComparison(runs))).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();
  SecurityContextHolder.clearContext();mvc.perform(get("/api/runs/"+UUID.randomUUID()+"/comparison/"+UUID.randomUUID())).andExpect(status().isUnauthorized());verifyNoInteractions(runs);
 }
}
