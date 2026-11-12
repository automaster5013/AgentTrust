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
    public record Agent(String key,Integer version,String provider,String description,String evaluationMode) {public Agent(String k,Integer v,String p,String d){this(k,v,p,d,null);}}
    public record Dataset(String key,Integer version,List<VersionDefinition.Case> cases,String evaluationMode,com.fasterxml.jackson.databind.JsonNode recordedCases) {public Dataset(String k,Integer v,List<VersionDefinition.Case> c){this(k,v,c,null,null);}public Dataset(String k,Integer v,List<VersionDefinition.Case> c,String mode){this(k,v,c,mode,null);}}
    @GetMapping("/{kind:agents|datasets}") List<Map<String,Object>> list(@AuthenticationPrincipal DemoUser user,@PathVariable String kind){return registry.list(user,kind).stream().map(VersionResponse::exactTimestamp).toList();}
    @GetMapping("/{kind:agents|datasets}/{id}") Map<String,Object> get(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable UUID id){return VersionResponse.exactTimestamp(registry.get(user,kind,id));}
    @PostMapping("/agents") Map<String,Object> agent(@AuthenticationPrincipal DemoUser user,@RequestBody Agent body){return VersionResponse.exactTimestamp(registry.registerAgent(user,body.key(),body.version(),body.provider(),body.description(),body.evaluationMode()));}
    @PostMapping("/datasets") Map<String,Object> dataset(@AuthenticationPrincipal DemoUser user,@RequestBody Dataset body){
        boolean recorded="recorded-text-rules".equals(body.evaluationMode());String content;
        if(recorded){if(body.cases()!=null)throw new IllegalArgumentException("Mixed dataset contracts");content=RecordedTextDefinition.dataset(mapper,body.recordedCases());}
        else {if(body.recordedCases()!=null)throw new IllegalArgumentException("Mixed dataset contracts");content=reference(body.evaluationMode())?QualityDefinition.dataset(mapper,body.cases()):VersionDefinition.dataset(mapper,body.cases());}
        return VersionResponse.exactTimestamp(registry.register(user,"datasets",body.key(),body.version(),content));
    }
    static boolean reference(String mode){if(mode==null||mode.equals("fixed-scenarios"))return false;if(mode.equals("reference-answer"))return true;throw new IllegalArgumentException("Unsupported evaluation mode");}
}
