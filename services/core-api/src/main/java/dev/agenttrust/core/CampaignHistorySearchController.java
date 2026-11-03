package dev.agenttrust.core;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/campaign-history-search/{dataset}/{approval}/{agent}")
public class CampaignHistorySearchController {
    private final CampaignHistoryReader reader;
    public CampaignHistorySearchController(CampaignHistoryReader reader){this.reader=reader;}
    @GetMapping CampaignHistoryReader.SearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String dataset,@PathVariable String approval,@PathVariable String agent,HttpServletRequest request){return search(user,dataset,approval,agent,null,request);}
    @GetMapping("/{cursor}") CampaignHistoryReader.SearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String dataset,@PathVariable String approval,@PathVariable String agent,@PathVariable String cursor,HttpServletRequest request){return search(user,dataset,approval,agent,cursor,request);}
    private CampaignHistoryReader.SearchPage search(DemoUser user,String dataset,String approval,String agent,String cursor,HttpServletRequest request){
        if(request.getQueryString()!=null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        try{return reader.search(user,CampaignHistoryFilters.optionalId(dataset),new CampaignHistoryFilters(approval,CampaignHistoryFilters.optionalId(agent)),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
    }
}
