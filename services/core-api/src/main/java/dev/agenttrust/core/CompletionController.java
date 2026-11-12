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
    public record Reservation(UUID runId,UUID organizationId,UUID projectId,String scenario,String provider,UUID campaignId,String caseId,UUID agentVersionId,UUID datasetVersionId,String executionProfileSha256,Map<String,String> qualityCase) {}
    @PostMapping("/internal/provider-reservations") Map<String,Object> reserve(@RequestHeader(value="X-AgentTrust-Worker-Token",required=false) String supplied,@RequestBody Reservation body){
        if(supplied==null||supplied.length()!=64||!MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(body.runId()==null||body.organizationId()==null||body.projectId()==null||body.scenario()==null||body.provider()==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var scope=new DemoUser("worker-budget","unused",body.organizationId(),body.projectId(),new UUID(0,0),"viewer");
        runs.validateBinding(scope,body.runId(),binding(body.campaignId(),body.caseId(),body.agentVersionId(),body.datasetVersionId(),body.executionProfileSha256(),body.qualityCase()));
        return budget.reserve(scope,body.runId(),body.scenario(),body.provider());
    }
    public record Completion(UUID runId,UUID organizationId,UUID projectId,String scenario,Evaluation.Result result,String provider,UUID campaignId,String caseId,UUID agentVersionId,UUID datasetVersionId,String executionProfileSha256,Map<String,String> qualityCase,Map<String,Object> recordedCase,Map<String,Object> connectorCase) {
        public Completion(UUID r,UUID o,UUID p,String s,Evaluation.Result result,String provider,UUID c,String i,UUID a,UUID d,String hash,Map<String,String> q){this(r,o,p,s,result,provider,c,i,a,d,hash,q,null,null);}public Completion(UUID r,UUID o,UUID p,String s,Evaluation.Result result,String provider,UUID c,String i,UUID a,UUID d,String hash,Map<String,String> q,Map<String,Object> recorded){this(r,o,p,s,result,provider,c,i,a,d,hash,q,recorded,null);}
    }
    @PostMapping("/internal/completions") Map<String,Object> complete(@RequestHeader(value="X-AgentTrust-Worker-Token",required=false) String supplied,@RequestBody Completion body) {
        if(supplied==null || supplied.length()!=64 || !MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(body.runId()==null||body.organizationId()==null||body.projectId()==null||body.scenario()==null||body.result()==null||"python-unavailable".equals(body.result().executionEngine()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var scope=new DemoUser("worker-callback","unused",body.organizationId(),body.projectId(),new UUID(0,0),"viewer");
        var base=binding(body.campaignId(),body.caseId(),body.agentVersionId(),body.datasetVersionId(),body.executionProfileSha256(),body.qualityCase());
        if(body.recordedCase()!=null){
            if(base==null||body.qualityCase()!=null||body.executionProfileSha256()==null||!"synthetic".equals(body.provider())||!"quality".equals(body.scenario()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
            base=new RunService.CampaignBinding(base.campaignId(),base.caseId(),base.agentVersionId(),base.datasetVersionId(),base.executionProfileSha256(),null,body.recordedCase());
        }
        if(body.connectorCase()!=null){if(base==null||body.recordedCase()!=null||body.qualityCase()!=null||body.executionProfileSha256()==null||!"synthetic".equals(body.provider())||!"quality".equals(body.scenario()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);base=new RunService.CampaignBinding(base.campaignId(),base.caseId(),base.agentVersionId(),base.datasetVersionId(),base.executionProfileSha256(),null,null,body.connectorCase());}
        return runs.complete(scope,body.runId(),body.scenario(),body.result(),base);
    }
    static RunService.CampaignBinding binding(UUID campaignId,String caseId,UUID agent,UUID dataset){return binding(campaignId,caseId,agent,dataset,null);}
    static RunService.CampaignBinding binding(UUID campaignId,String caseId,UUID agent,UUID dataset,String profile){
        return binding(campaignId,caseId,agent,dataset,profile,null);
    }
    static RunService.CampaignBinding binding(UUID campaignId,String caseId,UUID agent,UUID dataset,String profile,Map<String,String> sample){
        if(campaignId==null&&caseId==null&&agent==null&&dataset==null&&profile==null&&sample==null)return null;
        if(campaignId==null||caseId==null||agent==null||dataset==null||!caseId.matches("[a-z][a-z0-9-]{0,63}")||profile!=null&&!profile.matches("[a-f0-9]{64}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return new RunService.CampaignBinding(campaignId,caseId,agent,dataset,profile,sample);
    }
}
