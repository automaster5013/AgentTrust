package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="agenttrust.identity-mode",havingValue="local-demo",matchIfMissing=true)
public class SecurityConfiguration {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
    @Bean UserDetailsService users(@Value("${agenttrust.demo-credentials-file}") String file, ObjectMapper mapper, PasswordEncoder encoder) throws Exception {
        Path path = Path.of(file); long size = Files.size(path);
        if (size < 1 || size > 16384) throw new IllegalStateException("Invalid local authentication configuration");
        var root = mapper.readTree(Files.readString(path));
        if (!root.isArray() || root.size() < 1 || root.size() > 20) throw new IllegalStateException("Invalid local authentication configuration");
        List<UserDetails> users = new ArrayList<>(); var names = new HashSet<String>();
        for (var row : root) {
            String username = row.path("username").asText(), password = row.path("password").asText(), role = row.path("role").asText();
            if (!username.matches("[a-z][a-z0-9-]{2,40}") || !names.add(username) || password.length() < 32 || password.length() > 72 || !List.of("admin","editor","viewer").contains(role)) throw new IllegalStateException("Invalid local authentication configuration");
            users.add(new DemoUser(username,encoder.encode(password),UUID.fromString(row.path("organizationId").asText()),UUID.fromString(row.path("projectId").asText()),UUID.fromString(row.path("actorId").asText()),role));
        }
        return username -> {
            DemoUser template=(DemoUser)users.stream().filter(user -> user.getUsername().equals(username)).findFirst().orElseThrow(() -> new UsernameNotFoundException("Authentication failed"));
            // Spring erases authenticated credentials. Never return the reusable account template.
            return new DemoUser(template.getUsername(),template.getPassword(),template.organizationId(),template.projectId(),template.actorId(),template.role());
        };
    }
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth.requestMatchers("/actuator/health","/api/csrf","/api/login","/api/auth-info","/internal/completions","/internal/provider-reservations").permitAll().anyRequest().authenticated());
        http.csrf(csrf -> csrf.ignoringRequestMatchers("/internal/completions","/internal/provider-reservations"));
        http.formLogin(login -> login.loginProcessingUrl("/api/login")
            .successHandler((req,res,auth) -> {res.setContentType("application/json");res.getWriter().write("{\"authenticated\":true}");})
            .failureHandler((req,res,error) -> {res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"AUTHENTICATION_FAILED\"}");}));
        http.logout(logout -> logout.logoutUrl("/api/logout").logoutSuccessHandler((req,res,auth) -> {res.setContentType("application/json");res.getWriter().write("{\"authenticated\":false}");}));
        http.exceptionHandling(errors -> errors.authenticationEntryPoint((req,res,error) -> {res.setStatus(401);res.setContentType("application/json");res.getWriter().write("{\"code\":\"AUTHENTICATION_REQUIRED\"}");})
            .accessDeniedHandler((req,res,error) -> {res.setStatus(403);res.setContentType("application/json");res.getWriter().write("{\"code\":\"REQUEST_REFUSED\"}");}));
        http.sessionManagement(session -> session.sessionFixation(fixation -> fixation.migrateSession()));
        return http.build();
    }
}
