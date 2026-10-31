package dev.agenttrust.core;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.*;

/** Dedicated metadata-read credential endpoint. Browser cookies confer no authority here. */
@RestController
public class WorkspaceAccessKeyEndpoint {
 private final WorkspaceManagement management;
 public WorkspaceAccessKeyEndpoint(WorkspaceManagement management){this.management=management;}
 @GetMapping("/api/access-key/project") ResponseEntity<WorkspaceManagement.Project> project(@RequestHeader(value="Authorization",required=false) String header){return ResponseEntity.ok().header("Cache-Control","no-store").body(management.projectWithKey(header));}
 @Configuration
 static class KeySecurity {
  @Bean @Order(0) SecurityFilterChain projectKeySecurity(HttpSecurity http)throws Exception{
   http.securityMatcher("/api/access-key/project").sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).requestCache(c->c.disable());
   http.authorizeHttpRequests(a->a.requestMatchers(HttpMethod.GET,"/api/access-key/project").permitAll().anyRequest().denyAll());
   return http.build();
  }
 }
}
