package dev.agenttrust.core;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="agenttrust.gate-signing-mode",havingValue="local-development")
@RestController
@RequestMapping("/api/receipt-history")
public class ReceiptHistoryController {
    private final ReceiptHistoryReader reader;
    public ReceiptHistoryController(ReceiptHistoryReader reader){this.reader=reader;}
    @GetMapping ReceiptHistoryReader.Page first(@AuthenticationPrincipal DemoUser user){return reader.page(user,null,null);}
    @GetMapping("/page/{cursor}") ReceiptHistoryReader.Page next(@AuthenticationPrincipal DemoUser user,@PathVariable String cursor){return reader.page(user,null,cursor);}
    @GetMapping("/campaign/{campaign}") ReceiptHistoryReader.Page filtered(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign){return reader.page(user,campaign,null);}
    @GetMapping("/campaign/{campaign}/page/{cursor}") ReceiptHistoryReader.Page filteredNext(@AuthenticationPrincipal DemoUser user,@PathVariable UUID campaign,@PathVariable String cursor){return reader.page(user,campaign,cursor);}
}
