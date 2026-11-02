package dev.agenttrust.core;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/run-history-search/{scenario}/{approval}/{state}/{decision}/{provider}")
public class RunHistorySearchController {
    private final RunHistoryReader reader;
    public RunHistorySearchController(RunHistoryReader reader){this.reader=reader;}
    @GetMapping RunHistoryReader.SearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String scenario,@PathVariable String approval,@PathVariable String state,@PathVariable String decision,@PathVariable String provider,HttpServletRequest request){return search(user,scenario,approval,state,decision,provider,null,request);}
    @GetMapping("/{cursor}") RunHistoryReader.SearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String scenario,@PathVariable String approval,@PathVariable String state,@PathVariable String decision,@PathVariable String provider,@PathVariable String cursor,HttpServletRequest request){return search(user,scenario,approval,state,decision,provider,cursor,request);}
    private RunHistoryReader.SearchPage search(DemoUser user,String scenario,String approval,String state,String decision,String provider,String cursor,HttpServletRequest request){
        if(request.getQueryString()!=null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        try{return reader.search(user,new RunHistoryFilters(scenario,approval,state,decision,provider),cursor);}catch(IllegalArgumentException invalid){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
    }
}
