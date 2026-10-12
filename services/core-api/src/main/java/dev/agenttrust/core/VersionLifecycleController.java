package dev.agenttrust.core;

import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/versions/{kind:agents|datasets}/{id}/lifecycle")
public class VersionLifecycleController {
    private final VersionLifecycle lifecycle;
    public VersionLifecycleController(VersionLifecycle lifecycle){this.lifecycle=lifecycle;}
    public record Retirement(String reason) {}
    @GetMapping Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable UUID id){return lifecycle.get(user,kind,id);}
    @PostMapping("/retirement") Map<String,Object> retire(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable UUID id,@RequestBody Retirement body){return lifecycle.retire(user,kind,id,body.reason());}
}
