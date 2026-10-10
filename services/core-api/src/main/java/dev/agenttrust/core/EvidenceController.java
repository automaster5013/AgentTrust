package dev.agenttrust.core;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnProperty(name="agenttrust.object-mode",havingValue="minio")
public class EvidenceController {
 private final EvidenceArchives archives;
 public EvidenceController(EvidenceArchives archives){this.archives=archives;}
 @GetMapping("/api/runs/{id}/evidence") Map<String,Object> evidence(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id){return archives.evidence(user,id);}
}
