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
class VersionCapacityControllerTest {
 @Test void authenticatedRouteReturnsProjectCountsAndRejectsWrites()throws Exception{
  var capacity=mock(VersionCapacity.class);var mvc=MockMvcBuilders.standaloneSetup(new VersionCapacityController(capacity)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  when(capacity.read(user)).thenReturn(new VersionCapacity.Snapshot("project-version-capacity-v1","project",user.organizationId(),user.projectId(),Instant.now(),new VersionCapacity.Count(10,200,190,false),new VersionCapacity.Count(20,200,180,false),false,false));
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));try{mvc.perform(get("/api/version-capacity")).andExpect(status().isOk()).andExpect(jsonPath("$.projectId").value(user.projectId().toString())).andExpect(jsonPath("$.agents.remaining").value(190)).andExpect(jsonPath("$.reservationGranted").value(false));mvc.perform(post("/api/version-capacity")).andExpect(status().isMethodNotAllowed());verify(capacity).read(user);verifyNoMoreInteractions(capacity);}finally{SecurityContextHolder.clearContext();}
 }
}
