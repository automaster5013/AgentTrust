package dev.agenttrust.core;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class RunComparisonController {
 private final RunComparison comparison;
 public RunComparisonController(RunComparison comparison){this.comparison=comparison;}
 @GetMapping("/api/runs/{candidateId}/comparison/{baselineId}")
 Map<String,Object> compare(@AuthenticationPrincipal DemoUser user,@PathVariable UUID candidateId,@PathVariable UUID baselineId){return comparison.compare(user,candidateId,baselineId);}
}
