package dev.agenttrust.core;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class CompletionController {
    private final RunService runs;private final ProviderBudget budget;private final byte[] token;
    public CompletionController(RunService runs,ProviderBudget budget) throws Exception {this.runs=runs;this.budget=budget;var value=Files.readString(Path.of("/run/secrets/stack-worker-token"));if(!value.matches("[a-f0-9]{64}"))throw new IllegalStateException("Worker configuration unavailable");token=value.getBytes(StandardCharsets.US_ASCII);}
    public record Reservation(UUID runId,UUID organizationId,UUID projectId,String scenario,String provider,UUID campaignId,String caseId,UUID agentVersionId,UUID datasetVersionId) {}
    @PostMapping("/internal/provider-reservations") Map<String,Object> reserve(@RequestHeader(value="X-AgentTrust-Worker-Token",required=false) String supplied,@RequestBody Reservation body){
        if(supplied==null||supplied.length()!=64||!MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(body.runId()==null||body.organizationId()==null||body.projectId()==null||body.scenario()==null||body.provider()==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var scope=new DemoUser("worker-budget","unused",body.organizationId(),body.projectId(),new UUID(0,0),"viewer");
        runs.validateBinding(scope,body.runId(),binding(body.campaignId(),body.caseId(),body.agentVersionId(),body.datasetVersionId()));
        return budget.reserve(scope,body.runId(),body.scenario(),body.provider());
    }
    public record Completion(UUID runId,UUID organizationId,UUID projectId,String scenario,Evaluation.Result result,String provider,UUID campaignId,String caseId,UUID agentVersionId,UUID datasetVersionId) {}
    @PostMapping("/internal/completions") Map<String,Object> complete(@RequestHeader(value="X-AgentTrust-Worker-Token",required=false) String supplied,@RequestBody Completion body) {
        if(supplied==null || supplied.length()!=64 || !MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(body.runId()==null||body.organizationId()==null||body.projectId()==null||body.scenario()==null||body.result()==null||"python-unavailable".equals(body.result().executionEngine()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var scope=new DemoUser("worker-callback","unused",body.organizationId(),body.projectId(),new UUID(0,0),"viewer");
        return runs.complete(scope,body.runId(),body.scenario(),body.result(),binding(body.campaignId(),body.caseId(),body.agentVersionId(),body.datasetVersionId()));
    }
    static RunService.CampaignBinding binding(UUID campaignId,String caseId,UUID agent,UUID dataset){
        if(campaignId==null&&caseId==null&&agent==null&&dataset==null)return null;
        if(campaignId==null||caseId==null||agent==null||dataset==null||!caseId.matches("[a-z][a-z0-9-]{0,63}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return new RunService.CampaignBinding(campaignId,caseId,agent,dataset);
    }
}
