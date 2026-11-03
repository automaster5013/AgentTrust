package dev.agenttrust.core;
import org.springframework.http.HttpStatus;import org.springframework.security.core.annotation.AuthenticationPrincipal;import org.springframework.web.bind.annotation.*;import org.springframework.web.server.ResponseStatusException;
@RestController
@RequestMapping("/api/audit-period-search/{start}/{end}/{actor}/{action}/{resource}")
public class AuditPeriodSearchController {
 private final AuditReader reader;
 public AuditPeriodSearchController(AuditReader reader){this.reader=reader;}
 @GetMapping AuditReader.PeriodSearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String start,@PathVariable String end,@PathVariable String actor,@PathVariable String action,@PathVariable String resource){return search(user,start,end,actor,action,resource,null);}
 @GetMapping("/{cursor}") AuditReader.PeriodSearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String start,@PathVariable String end,@PathVariable String actor,@PathVariable String action,@PathVariable String resource,@PathVariable String cursor){return search(user,start,end,actor,action,resource,cursor);}
 private AuditReader.PeriodSearchPage search(DemoUser user,String start,String end,String actor,String action,String resource,String cursor){try{return reader.periodSearch(user,AuditPeriod.parse(start,end,actor,action,resource),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}}
}
