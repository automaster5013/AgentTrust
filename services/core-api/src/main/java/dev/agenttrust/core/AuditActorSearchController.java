package dev.agenttrust.core;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/audit-actor-search/{actor}/{action}/{resource}")
public class AuditActorSearchController {
 private final AuditReader reader;
 public AuditActorSearchController(AuditReader reader){this.reader=reader;}
 @GetMapping AuditReader.ActorSearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String actor,@PathVariable String action,@PathVariable String resource){return search(user,actor,action,resource,null);}
 @GetMapping("/{cursor}") AuditReader.ActorSearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String actor,@PathVariable String action,@PathVariable String resource,@PathVariable String cursor){return search(user,actor,action,resource,cursor);}
 private AuditReader.ActorSearchPage search(DemoUser user,String actor,String action,String resource,String cursor){try{return reader.actorSearch(user,AuditActorCursor.actor(actor),AuditFilters.parse(action,resource),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}}
}
