package dev.agenttrust.core;

import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class CampaignGateCheckController {
    private final CampaignGateChecks checks;
    public CampaignGateCheckController(CampaignGateChecks checks){this.checks=checks;}
    @GetMapping("/api/campaigns/{campaign}/gate-check/{challenge}")
    ResponseEntity<Map<String,Object>> check(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign,@PathVariable String challenge) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(checks.check(user,campaign,challenge));
    }
}
