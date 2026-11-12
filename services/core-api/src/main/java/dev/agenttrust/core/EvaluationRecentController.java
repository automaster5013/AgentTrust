package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class EvaluationRecentController {
 private final EvaluationRecent overview;
 public EvaluationRecentController(EvaluationRecent overview){this.overview=overview;}
 @GetMapping("/api/evaluation-recent") EvaluationRecent.Snapshot read(@AuthenticationPrincipal DemoUser user){return overview.read(user);}
}
