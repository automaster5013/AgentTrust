package dev.agenttrust.core;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/campaign-requests")
public class CampaignRequestsController {
    private final CampaignService campaigns;
    public CampaignRequestsController(CampaignService campaigns){this.campaigns=campaigns;}
    @GetMapping("/{key}") Map<String,Object> resolve(@AuthenticationPrincipal DemoUser user,@PathVariable String key){return campaigns.resolveRequest(user,key);}
}
