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
import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;

/** Discovers only admitted namespaces, then reads each payload under its original RLS scope. */
@Component
public class QueuePublisher {
    private final RunService runs; private final ObjectMapper mapper; private final PendingWorkspaceScopes scopes;
    private PendingWorkspaceScopes.Scope cursor;
    private final String token; private Connection connection;
    @Autowired public QueuePublisher(RunService runs, ObjectMapper mapper,PendingWorkspaceScopes scopes) throws Exception {
        this(runs,mapper,scopes,Files.readString(Path.of("/run/secrets/stack-nats-token")));
    }
    QueuePublisher(RunService runs,ObjectMapper mapper,PendingWorkspaceScopes scopes,String token){
        this.runs=runs;this.mapper=mapper;this.scopes=scopes;this.token=token;
        if(!token.matches("[a-f0-9]{64}"))throw new IllegalStateException("Queue configuration unavailable");
    }
    @Scheduled(fixedDelay=2000,initialDelay=2000)
    void dispatch() {
        java.util.List<PendingWorkspaceScopes.Scope> page;
        try{page=scopes.after(cursor);}catch(Exception unavailable){return;}
        if(page.isEmpty()){cursor=null;return;}
        int handled=0;
        for(var namespace:page) {
            var scope=new DemoUser("queue-dispatcher","unused",namespace.organizationId(),namespace.projectId(),new UUID(0,0),"viewer");
            try {
                for(var run:runs.pending(scope)) {
                    if(handled>=40)break;
                    handled++;
                    UUID id=(UUID)run.get("id");
                    if((Boolean)run.get("expired")) {runs.complete(scope,id,(String)run.get("scenario"),WorkerClient.unavailable());continue;}
                    if(connection==null || connection.getStatus()==Connection.Status.CLOSED) connection=Nats.connect(new Options.Builder().server("nats://stack-nats:4222").token(token.toCharArray()).connectionTimeout(Duration.ofSeconds(2)).maxReconnects(-1).build());
                    var body=runs.job(scope,run);
                    String subject="quality".equals(run.get("scenario"))?"stack.quality-evaluations":"stack.evaluations";
                    QueueTracing.publish(headers -> connection.jetStream().publish(subject,headers,mapper.writeValueAsBytes(body),PublishOptions.builder().messageId(id.toString()).streamTimeout(Duration.ofSeconds(2)).build()));
                }
            } catch(Exception error) {
                if(error instanceof InterruptedException)Thread.currentThread().interrupt();
                // Persistent admission remains queued and is retried next cycle. No payload or credential logging.
            }
            cursor=namespace;
            if(handled>=40)return;
        }
        if(page.size()<PendingWorkspaceScopes.PAGE_LIMIT)cursor=null;
    }
    @PreDestroy void close() throws Exception {if(connection!=null)connection.close();}
}
