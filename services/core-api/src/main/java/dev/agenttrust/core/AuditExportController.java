package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/audit-export")
public class AuditExportController {
    private final AuditExport exports;
    public AuditExportController(AuditExport exports){this.exports=exports;}
    @GetMapping public java.util.Map<String,Object> export(@AuthenticationPrincipal DemoUser user){return exports.export(user);}
}
