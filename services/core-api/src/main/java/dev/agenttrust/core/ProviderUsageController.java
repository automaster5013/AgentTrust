package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class ProviderUsageController {
    private final ProviderUsageReader reader;
    public ProviderUsageController(ProviderUsageReader reader){this.reader=reader;}
    @GetMapping("/api/provider-usage") ProviderUsageReader.Usage read(@AuthenticationPrincipal DemoUser user){return reader.read(user);}
}
