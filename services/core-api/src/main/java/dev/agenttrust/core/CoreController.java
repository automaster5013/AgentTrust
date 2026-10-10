package dev.agenttrust.core;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class CoreController {
    private final RunService service;
    public CoreController(RunService service) {this.service=service;}
    @GetMapping("/csrf") Map<String,String> csrf(HttpServletRequest request) {var csrf=(CsrfToken)request.getAttribute(CsrfToken.class.getName());return Map.of("token",csrf.getToken(),"headerName",csrf.getHeaderName());}
    @GetMapping("/me") Map<String,Object> me(@AuthenticationPrincipal DemoUser user) {return Map.of("username",user.getUsername(),"organizationId",user.organizationId(),"projectId",user.projectId(),"actorId",user.actorId(),"role",user.role(),"identityProvider",user instanceof OidcWorkspaceUser?"keycloak":"local-demo","runtime","java21-spring-boot");}
    @GetMapping("/runs") List<Map<String,Object>> list(@AuthenticationPrincipal DemoUser user) {return service.list(user);}
    @GetMapping("/runs/{id}") Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id) {return service.get(user,id);}
    public record Create(@NotBlank @Pattern(regexp="pass|block|missing_evidence|error") String scenario, @NotNull Boolean requiresApproval,@Pattern(regexp="synthetic|ollama|openai|openai-compatible") String provider) {}
    @PostMapping("/runs") Map<String,Object> create(@AuthenticationPrincipal DemoUser user,@RequestHeader("Idempotency-Key") String key,@Valid @RequestBody Create body) {return service.create(user,key,body.scenario(),body.requiresApproval(),body.provider()==null?"synthetic":body.provider());}
    public record Review(@NotBlank @Pattern(regexp="approved|rejected") String decision,@NotBlank @Size(max=500) String reason) {}
    @GetMapping("/runs/{id}/reviews") List<Map<String,Object>> reviews(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id) {return service.reviews(user,id);}
    @PostMapping("/runs/{id}/reviews") Map<String,Object> review(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id,@Valid @RequestBody Review body) {return service.review(user,id,body.decision(),body.reason());}
    @GetMapping("/runs/{id}/gate") Evaluation.Gate gate(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id) {return service.gate(user,id);}
}
