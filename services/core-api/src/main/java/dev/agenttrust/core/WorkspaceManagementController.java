package dev.agenttrust.core;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workspace")
public class WorkspaceManagementController {
 private final WorkspaceManagement management;private final WorkspaceSessions sessions;
 public WorkspaceManagementController(WorkspaceManagement management,WorkspaceSessions sessions){this.management=management;this.sessions=sessions;}
 public record Settings(@NotNull com.fasterxml.jackson.databind.JsonNode expectedRevision,@NotBlank @Size(max=80) String name,@NotNull @Size(max=500) String description){}
 public record CreateKey(@NotNull UUID id,@NotBlank @Size(max=80) String name,@NotNull com.fasterxml.jackson.databind.JsonNode days){}
 static long number(com.fasterxml.jackson.databind.JsonNode value,long min,long max){if(value==null||!value.isIntegralNumber()||!value.canConvertToLong()||value.longValue()<min||value.longValue()>max)throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST);return value.longValue();}
 @GetMapping("/project") WorkspaceManagement.Project project(@AuthenticationPrincipal DemoUser user){return management.project(user);}
 @PostMapping("/project") WorkspaceManagement.Project update(@AuthenticationPrincipal DemoUser user,@Valid @RequestBody Settings body){return management.update(user,number(body.expectedRevision(),0,999999999),body.name(),body.description());}
 @GetMapping("/access-keys") WorkspaceManagement.Keys keys(@AuthenticationPrincipal DemoUser user){return management.keys(user);}
 @PostMapping("/access-keys") ResponseEntity<WorkspaceManagement.Issued> issue(@AuthenticationPrincipal DemoUser user,@Valid @RequestBody CreateKey body){return ResponseEntity.ok().header("Cache-Control","no-store").body(management.issue(user,body.id(),body.name(),(int)number(body.days(),1,30)));}
 @PostMapping("/access-keys/{id}/revoke") WorkspaceManagement.Keys revoke(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id){return management.revoke(user,id);}
 @GetMapping("/sessions") WorkspaceSessions.Page sessions(@AuthenticationPrincipal DemoUser user,HttpServletRequest request){return sessions.list(user,request.getSession(false));}
 @PostMapping("/sessions/{id}/revoke") WorkspaceSessions.Page revokeSession(@AuthenticationPrincipal DemoUser user,HttpServletRequest request,@PathVariable UUID id){return sessions.revoke(user,request.getSession(false),id);}
}
