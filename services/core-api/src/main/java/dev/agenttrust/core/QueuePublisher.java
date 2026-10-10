package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.nats.client.Connection;
import io.nats.client.Nats;
import io.nats.client.Options;
import io.nats.client.PublishOptions;
import jakarta.annotation.PreDestroy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Dispatches durable DB admissions for configured local scopes; never reads other scopes. */
@Component
public class QueuePublisher {
    private final RunService runs; private final ObjectMapper mapper; private final List<DemoUser> scopes;
    private final String token; private Connection connection;
    public QueuePublisher(RunService runs, ObjectMapper mapper, @Value("${agenttrust.demo-credentials-file}") String file) throws Exception {
        this.runs=runs;this.mapper=mapper;token=Files.readString(Path.of("/run/secrets/stack-nats-token"));
        if(!token.matches("[a-f0-9]{64}"))throw new IllegalStateException("Queue configuration unavailable");
        var known=new HashSet<String>();var values=new ArrayList<DemoUser>();
        for(var row:mapper.readTree(Files.readString(Path.of(file)))) {
            UUID org=UUID.fromString(row.path("organizationId").asText()),project=UUID.fromString(row.path("projectId").asText());
            if(known.add(org+"/"+project))values.add(new DemoUser("queue-dispatcher","unused",org,project,UUID.fromString(row.path("actorId").asText()),"admin"));
        }
        scopes=List.copyOf(values);
    }
    @Scheduled(fixedDelay=2000,initialDelay=2000)
    void dispatch() {
        for(var scope:scopes) {
            try {
                for(var run:runs.pending(scope)) {
                    UUID id=(UUID)run.get("id");
                    if((Boolean)run.get("expired")) {runs.complete(scope,id,(String)run.get("scenario"),WorkerClient.unavailable());continue;}
                    if(connection==null || connection.getStatus()==Connection.Status.CLOSED) connection=Nats.connect(new Options.Builder().server("nats://stack-nats:4222").token(token.toCharArray()).connectionTimeout(Duration.ofSeconds(2)).maxReconnects(-1).build());
                    var body=Map.of("runId",id.toString(),"organizationId",scope.organizationId().toString(),"projectId",scope.projectId().toString(),"scenario",run.get("scenario"),"provider",run.get("provider"));
                    connection.jetStream().publish("stack.evaluations",mapper.writeValueAsBytes(body),PublishOptions.builder().messageId(id.toString()).streamTimeout(Duration.ofSeconds(2)).build());
                }
            } catch(Exception error) {
                if(error instanceof InterruptedException)Thread.currentThread().interrupt();
                // Persistent admission remains queued and is retried next cycle. No payload or credential logging.
            }
        }
    }
    @PreDestroy void close() throws Exception {if(connection!=null)connection.close();}
}
