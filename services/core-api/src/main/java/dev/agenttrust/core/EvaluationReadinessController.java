package dev.agenttrust.core;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class EvaluationReadinessController {
 private final EvaluationReadiness reader;
 public EvaluationReadinessController(EvaluationReadiness reader){this.reader=reader;}
 @GetMapping("/api/evaluation-readiness") ResponseEntity<EvaluationReadiness.Observation> read(@AuthenticationPrincipal DemoUser user){
  var result=reader.read(user);return ResponseEntity.status(result.ready()?200:503).body(result);
 }
}
