package dev.agenttrust.core;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/campaigns")
public class CampaignController {
    private final CampaignService campaigns;
    public CampaignController(CampaignService campaigns){this.campaigns=campaigns;}
    public record Create(UUID agentVersionId,UUID datasetVersionId,Boolean requiresApproval) {}
    public record Review(String decision,String reason) {}
    @GetMapping List<Map<String,Object>> list(@AuthenticationPrincipal DemoUser user){return campaigns.list(user);}
    @PostMapping Map<String,Object> create(@AuthenticationPrincipal DemoUser user,@RequestHeader("Idempotency-Key") String key,@RequestBody Create body){return campaigns.create(user,key,body.agentVersionId(),body.datasetVersionId(),body.requiresApproval());}
    @GetMapping("/{id}") Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id){return campaigns.get(user,id);}
    @GetMapping("/{id}/gate") Evaluation.Gate gate(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id){return campaigns.gate(user,id);}
    @PostMapping("/{id}/reviews") Map<String,Object> review(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id,@RequestBody Review body){return campaigns.review(user,id,body.decision(),body.reason());}
    @GetMapping("/{id}/comparison/{baseline}") Map<String,Object> compare(@AuthenticationPrincipal DemoUser user,@PathVariable UUID id,@PathVariable UUID baseline){return campaigns.compare(user,id,baseline);}
}
