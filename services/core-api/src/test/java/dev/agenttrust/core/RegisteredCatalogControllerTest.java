package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.UUID;
class RegisteredCatalogControllerTest {
 @Test void routeIsReadOnlyAndAnonymousReadsAreRejected()throws Exception{
  var reader=mock(VersionHistoryReader.class);var service=new RegisteredCatalog(reader);
  var mvc=MockMvcBuilders.standaloneSetup(new RegisteredCatalogController(service)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();
  SecurityContextHolder.clearContext();mvc.perform(get("/api/catalog")).andExpect(status().isUnauthorized());verifyNoInteractions(reader);
  var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));
  when(reader.page(user,"agents",null)).thenReturn(new VersionHistoryReader.Page(user.organizationId(),user.projectId(),"agents",java.util.List.of(),null,25,"created-at-id-desc",false));
  when(reader.page(user,"datasets",null)).thenReturn(new VersionHistoryReader.Page(user.organizationId(),user.projectId(),"datasets",java.util.List.of(),null,25,"created-at-id-desc",false));
  try{mvc.perform(get("/api/catalog")).andExpect(status().isOk()).andExpect(jsonPath("$.deploymentAuthority").value(false)).andExpect(jsonPath("$.projectId").value(user.projectId().toString()));verify(reader).page(user,"agents",null);verify(reader).page(user,"datasets",null);mvc.perform(post("/api/catalog")).andExpect(status().isMethodNotAllowed());verifyNoMoreInteractions(reader);}finally{SecurityContextHolder.clearContext();}
 }
}
