package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/audit")
public class AuditController {
    private final AuditReader reader;
    public AuditController(AuditReader reader){this.reader=reader;}
    @GetMapping AuditReader.Page first(@AuthenticationPrincipal DemoUser user){return reader.page(user,null);}
    @GetMapping("/{cursor}") AuditReader.Page next(@AuthenticationPrincipal DemoUser user,@PathVariable String cursor){return reader.page(user,cursor);}
}
