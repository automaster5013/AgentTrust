package dev.agenttrust.core;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class VersionListPrecisionTest {
 @Test void registryListMustMatchExactDetailCoordinatesRatherThanCoarseJdbcTimestampSerialization()throws Exception{
  var registry=mock(VersionRegistry.class);var mapper=new ObjectMapper().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
  var time=Instant.parse("2026-11-12T00:00:00.123456Z");var timestamp=Timestamp.from(time);
  assertFalse(mapper.writeValueAsString(timestamp).contains("123456")); // Reproduce the old list/detail precision mismatch.
  var user=new DemoUser("fixture","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"editor");
  Map<String,Object> row=Map.of("id",UUID.randomUUID(),"resource_key","source-dataset","version",1,"content_sha256","a".repeat(64),"created_at",timestamp);
  var mvc=MockMvcBuilders.standaloneSetup(new VersionController(registry,mapper)).setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver()).build();
  SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,null,user.getAuthorities()));
  try{for(String kind:List.of("agents","datasets")){when(registry.list(user,kind)).thenReturn(List.of(row));mvc.perform(get("/api/versions/"+kind)).andExpect(status().isOk()).andExpect(jsonPath("$[0].created_at").value(time.toString()));}assertSame(timestamp,row.get("created_at"));}finally{SecurityContextHolder.clearContext();}
 }
}
