package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/versions")
public class VersionController {
    private final VersionRegistry registry;private final ObjectMapper mapper;
    public VersionController(VersionRegistry registry,ObjectMapper mapper){this.registry=registry;this.mapper=mapper;}
    public record Agent(String key,Integer version,String provider,String description) {}
    public record Dataset(String key,Integer version,List<VersionDefinition.Case> cases) {}
    @GetMapping("/{kind:agents|datasets}") List<Map<String,Object>> list(@AuthenticationPrincipal DemoUser user,@PathVariable String kind){return registry.list(user,kind);}
    @GetMapping("/{kind:agents|datasets}/{id}") Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable UUID id){return registry.get(user,kind,id);}
    @PostMapping("/agents") Map<String,Object> agent(@AuthenticationPrincipal DemoUser user,@RequestBody Agent body){return registry.registerAgent(user,body.key(),body.version(),body.provider(),body.description());}
    @PostMapping("/datasets") Map<String,Object> dataset(@AuthenticationPrincipal DemoUser user,@RequestBody Dataset body){return registry.register(user,"datasets",body.key(),body.version(),VersionDefinition.dataset(mapper,body.cases()));}
}
