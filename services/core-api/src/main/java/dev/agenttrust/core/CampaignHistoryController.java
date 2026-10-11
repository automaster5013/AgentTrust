package dev.agenttrust.core;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/campaign-history")
public class CampaignHistoryController {
    private final CampaignHistoryReader reader;
    public CampaignHistoryController(CampaignHistoryReader reader){this.reader=reader;}
    @GetMapping CampaignHistoryReader.Page first(@AuthenticationPrincipal DemoUser user){return reader.page(user,null,null);}
    @GetMapping("/page/{cursor}") CampaignHistoryReader.Page next(@AuthenticationPrincipal DemoUser user,@PathVariable String cursor){return reader.page(user,null,cursor);}
    @GetMapping("/dataset/{dataset}") CampaignHistoryReader.Page filtered(@AuthenticationPrincipal DemoUser user,@PathVariable UUID dataset){return reader.page(user,dataset,null);}
    @GetMapping("/dataset/{dataset}/page/{cursor}") CampaignHistoryReader.Page filteredNext(@AuthenticationPrincipal DemoUser user,@PathVariable UUID dataset,@PathVariable String cursor){return reader.page(user,dataset,cursor);}
}
