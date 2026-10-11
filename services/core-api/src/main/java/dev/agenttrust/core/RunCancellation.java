package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Server-owned terminal evidence. Worker completions cannot impersonate this engine. */
final class RunCancellation {
    static final String ENGINE="java-cancelled";
    private RunCancellation(){}
    static void reason(String value){if(value==null||value.isBlank()||value.length()>200)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
    static void owner(DemoUser user,UUID actor){
        if(!user.role().equals("admin")&&!(user.role().equals("editor")&&user.actorId().equals(actor)))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    static Evaluation.Result result(String reason){reason(reason);return new Evaluation.Result("failed","inconclusive",List.of(new Evaluation.Rule("evaluation-cancelled",true,"inconclusive","Evaluation cancelled: "+reason.strip())),ENGINE);}
    static boolean cancelled(JsonNode result){return result!=null&&ENGINE.equals(result.path("executionEngine").asText())&&"failed".equals(result.path("state").asText())&&"inconclusive".equals(result.path("decision").asText());}
}
