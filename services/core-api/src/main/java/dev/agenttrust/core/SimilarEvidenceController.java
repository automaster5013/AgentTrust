package dev.agenttrust.core;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class SimilarEvidenceController {
 private final SimilarEvidence similar;
 public SimilarEvidenceController(SimilarEvidence similar){this.similar=similar;}
 @GetMapping("/api/runs/{id}/similar") Map<String,Object> similar(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id){return similar.similar(user,id);}
}
