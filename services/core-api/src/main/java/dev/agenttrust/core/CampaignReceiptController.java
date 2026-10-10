package dev.agenttrust.core;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
public class CampaignReceiptController {
    private final CampaignReceipts receipts;private final GateSigner signer;
    public CampaignReceiptController(CampaignReceipts receipts,GateSigner signer){this.receipts=receipts;this.signer=signer;}
    public record Issue(String note){}
    @GetMapping("/api/gate-trust") Map<String,Object> trust(){return signer.trust();}
    @GetMapping("/api/campaigns/{campaign}/receipts") List<Map<String,Object>> list(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign){return receipts.list(user,campaign);}
    @GetMapping("/api/campaigns/{campaign}/receipts/{id}") Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign,@PathVariable UUID id){return receipts.get(user,campaign,id);}
    @PostMapping("/api/campaigns/{campaign}/receipts") Map<String,Object> issue(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign,@RequestHeader("Idempotency-Key") String key,@RequestBody Issue body){return receipts.issue(user,campaign,key,body.note());}
}
