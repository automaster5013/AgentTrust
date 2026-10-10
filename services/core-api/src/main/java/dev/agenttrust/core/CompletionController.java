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
    private final RunService runs;private final byte[] token;
    public CompletionController(RunService runs) throws Exception {this.runs=runs;var value=Files.readString(Path.of("/run/secrets/stack-worker-token"));if(!value.matches("[a-f0-9]{64}"))throw new IllegalStateException("Worker configuration unavailable");token=value.getBytes(StandardCharsets.US_ASCII);}
    public record Completion(UUID runId,UUID organizationId,UUID projectId,String scenario,Evaluation.Result result) {}
    @PostMapping("/internal/completions") Map<String,Object> complete(@RequestHeader(value="X-AgentTrust-Worker-Token",required=false) String supplied,@RequestBody Completion body) {
        if(supplied==null || supplied.length()!=64 || !MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.US_ASCII)))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        if(body.runId()==null||body.organizationId()==null||body.projectId()==null||body.scenario()==null||body.result()==null||"python-unavailable".equals(body.result().executionEngine()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        var scope=new DemoUser("worker-callback","unused",body.organizationId(),body.projectId(),new UUID(0,0),"viewer");
        return runs.complete(scope,body.runId(),body.scenario(),body.result());
    }
}
