package dev.agenttrust.core;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class ReceiptHistoryControllerTest {
 @Test void viewerMetadataReadHasNoWriteMapping()throws Exception{
  var reader=mock(ReceiptHistoryReader.class);var mvc=MockMvcBuilders.standaloneSetup(new ReceiptHistoryController(reader)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).setControllerAdvice(new ApiErrors()).build();var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
  when(reader.page(user,null,null)).thenReturn(new ReceiptHistoryReader.Page("project-receipt-history-v1",user.organizationId(),user.projectId(),null,List.of(),null,25,"created-at-id-desc",false,false));
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));try{mvc.perform(get("/api/receipt-history")).andExpect(status().isOk()).andExpect(jsonPath("$.signatureVerificationPerformed").value(false)).andExpect(jsonPath("$.deploymentAuthority").value(false));mvc.perform(post("/api/receipt-history")).andExpect(status().isMethodNotAllowed());verify(reader).page(user,null,null);verifyNoMoreInteractions(reader);}finally{SecurityContextHolder.clearContext();}
 }
}
