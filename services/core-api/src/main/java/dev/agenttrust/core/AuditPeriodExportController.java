package dev.agenttrust.core;
import org.springframework.http.HttpStatus;import org.springframework.security.core.annotation.AuthenticationPrincipal;import org.springframework.web.bind.annotation.*;import org.springframework.web.server.ResponseStatusException;
@RestController
@RequestMapping("/api/audit-period-export/{start}/{end}/{actor}/{action}/{resource}")
public class AuditPeriodExportController {
 private final AuditPeriodExport exports;public AuditPeriodExportController(AuditPeriodExport exports){this.exports=exports;}
 @GetMapping java.util.Map<String,Object> first(@AuthenticationPrincipal DemoUser user,@PathVariable String start,@PathVariable String end,@PathVariable String actor,@PathVariable String action,@PathVariable String resource){return export(user,start,end,actor,action,resource,null);}
 @GetMapping("/{cursor}") java.util.Map<String,Object> next(@AuthenticationPrincipal DemoUser user,@PathVariable String start,@PathVariable String end,@PathVariable String actor,@PathVariable String action,@PathVariable String resource,@PathVariable String cursor){return export(user,start,end,actor,action,resource,cursor);}
 private java.util.Map<String,Object> export(DemoUser user,String start,String end,String actor,String action,String resource,String cursor){try{return exports.export(user,AuditPeriod.parse(start,end,actor,action,resource),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}}
}
