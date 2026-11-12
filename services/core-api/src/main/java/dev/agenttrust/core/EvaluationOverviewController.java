package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class EvaluationOverviewController {
 private final EvaluationOverview overview;
 public EvaluationOverviewController(EvaluationOverview overview){this.overview=overview;}
 @GetMapping("/api/evaluation-overview") EvaluationOverview.Snapshot read(@AuthenticationPrincipal DemoUser user){return overview.read(user);}
}
