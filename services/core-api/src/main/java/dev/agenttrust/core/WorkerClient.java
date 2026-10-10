package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Fixed internal endpoint and scoped response. Transport or evidence errors fail closed. */
@Component
public class WorkerClient {
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final String token;
    public WorkerClient(ObjectMapper mapper) throws Exception {
        this.mapper = mapper;
        token = Files.readString(Path.of(System.getenv().getOrDefault("STACK_WORKER_TOKEN_FILE", "/run/secrets/stack-worker-token")));
        if (!token.matches("[a-f0-9]{64}")) throw new IllegalStateException("Worker authentication configuration unavailable");
    }
    public Evaluation.Result evaluate(DemoUser user, UUID runId, String scenario) {
        try {
            var body = Map.of("runId", runId.toString(), "organizationId", user.organizationId().toString(), "projectId", user.projectId().toString(), "scenario", scenario);
            var request = HttpRequest.newBuilder(URI.create("http://stack-ai-worker:8000/evaluate")).timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json").header("X-AgentTrust-Worker-Token", token).POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            byte[] bytes;
            try(var stream = response.body()) { bytes = stream.readNBytes(16385); }
            if(response.statusCode() != 200 || bytes.length > 16384) throw new IllegalStateException("Worker response unavailable");
            var value = mapper.readTree(bytes);
            for(var entry : body.entrySet()) if(!entry.getValue().equals(value.path(entry.getKey()).asText())) throw new IllegalStateException("Worker scope mismatch");
            var result = mapper.treeToValue(value.path("result"), Evaluation.Result.class);
            return validated(result);
        } catch (Exception error) {
            if(error instanceof InterruptedException) Thread.currentThread().interrupt();
            return unavailable();
        }
    }
    static Evaluation.Result validated(Evaluation.Result result) {
        if(result == null || !"python-synthetic".equals(result.executionEngine()) || !List.of("succeeded", "failed").contains(result.state()) || !List.of("pass", "block", "inconclusive").contains(result.decision()) || result.rules() == null || result.rules().isEmpty() || result.rules().size() > 100) throw new IllegalArgumentException("Invalid worker evidence");
        boolean failed = false, missing = false, required = false;
        for(var rule : result.rules()) {
            if(rule == null || rule.id() == null || rule.id().isBlank() || rule.id().length() > 100 || rule.reason() == null || rule.reason().length() > 500 || !List.of("pass", "fail", "inconclusive").contains(rule.status())) throw new IllegalArgumentException("Invalid worker rule");
            if(rule.required()) {required = true;failed |= rule.status().equals("fail");missing |= rule.status().equals("inconclusive");}
        }
        String expected = result.state().equals("failed") ? "inconclusive" : failed ? "block" : missing || !required ? "inconclusive" : "pass";
        if(!expected.equals(result.decision())) throw new IllegalArgumentException("Contradictory worker verdict");
        return result;
    }
    static Evaluation.Result unavailable() {
        return new Evaluation.Result("failed", "inconclusive", List.of(new Evaluation.Rule("worker-availability", true, "inconclusive", "Python worker response or scoped evidence was unavailable.")), "python-unavailable");
    }
}
