package dev.agenttrust.core;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/audit-search/{action}/{resource}")
public class AuditSearchController {
 private final AuditReader reader;
 public AuditSearchController(AuditReader reader){this.reader=reader;}
 @GetMapping AuditReader.SearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String action,@PathVariable String resource){return search(user,action,resource,null);}
 @GetMapping("/{cursor}") AuditReader.SearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String action,@PathVariable String resource,@PathVariable String cursor){return search(user,action,resource,cursor);}
 private AuditReader.SearchPage search(DemoUser user,String action,String resource,String cursor){try{return reader.search(user,AuditFilters.parse(action,resource),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}}
}
