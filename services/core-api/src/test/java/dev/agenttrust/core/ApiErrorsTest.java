package dev.agenttrust.core;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class ApiErrorsTest {
 @RestController static class Unavailable {
  @GetMapping("/data") Object data(){throw new org.springframework.dao.DataAccessResourceFailureException("private connection details");}
  @GetMapping("/rollback") Object rollback(){throw new org.springframework.transaction.TransactionSystemException("private rollback details");}
 }
 @Test void dataAndRollbackFailuresCannotReturnPermissionOrConnectionDetails() throws Exception {
  var mvc=MockMvcBuilders.standaloneSetup(new Unavailable()).setControllerAdvice(new ApiErrors()).build();
  for(String path:new String[]{"/data","/rollback"})mvc.perform(get(path)).andExpect(status().isServiceUnavailable()).andExpect(content().json("{\"code\":\"STORAGE_UNAVAILABLE\"}")).andExpect(jsonPath("$.deploymentAllowed").doesNotExist());
 }
}
