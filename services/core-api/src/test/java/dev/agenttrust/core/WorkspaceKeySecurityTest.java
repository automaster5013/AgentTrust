package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.mock.web.MockServletContext;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class WorkspaceKeySecurityTest {
 @Configuration @EnableWebSecurity @EnableWebMvc @Import({WorkspaceAccessKeyEndpoint.KeySecurity.class,WorkspaceAccessKeyEndpoint.class})
 static class Config {
  @Bean WorkspaceManagement management(){var value=mock(WorkspaceManagement.class);when(value.projectWithKey(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED));when(value.projectWithKey("Bearer synthetic-valid")).thenReturn(new WorkspaceManagement.Project(java.util.UUID.randomUUID(),java.util.UUID.randomUUID(),0,"Scoped","",null,false));return value;}
 }
 @Test void actualStatelessChainRequiresHeaderAndRefusesWritesWithoutCreatingSession()throws Exception{
  try(var context=new AnnotationConfigWebApplicationContext()){
   context.setServletContext(new MockServletContext());context.register(Config.class);context.refresh();
   var mvc=MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
   mvc.perform(get("/api/access-key/project")).andExpect(status().isUnauthorized());
   var result=mvc.perform(get("/api/access-key/project").header("Authorization","Bearer synthetic-valid")).andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andExpect(header().doesNotExist("Set-Cookie")).andReturn();assertNull(result.getRequest().getSession(false));
   mvc.perform(post("/api/access-key/project").header("Authorization","Bearer synthetic-valid")).andExpect(status().isForbidden());
  }
 }
}
