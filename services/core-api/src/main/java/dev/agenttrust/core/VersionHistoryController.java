package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/version-history")
public class VersionHistoryController {
 private final VersionHistoryReader reader;
 public VersionHistoryController(VersionHistoryReader reader){this.reader=reader;}
 @GetMapping("/{kind:agents|datasets}") VersionHistoryReader.Page first(@AuthenticationPrincipal DemoUser user,@PathVariable String kind){return reader.page(user,kind,null);}
 @GetMapping("/{kind:agents|datasets}/{cursor:[A-Za-z0-9_-]{84}}") VersionHistoryReader.Page next(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable String cursor){return reader.page(user,kind,cursor);}
}
