package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/run-history")
public class RunHistoryController {
    private final RunHistoryReader reader;
    public RunHistoryController(RunHistoryReader reader){this.reader=reader;}
    @GetMapping RunHistoryReader.Page first(@AuthenticationPrincipal DemoUser user){return reader.page(user,null);}
    @GetMapping("/{cursor}") RunHistoryReader.Page next(@AuthenticationPrincipal DemoUser user,@PathVariable String cursor){return reader.page(user,cursor);}
}
