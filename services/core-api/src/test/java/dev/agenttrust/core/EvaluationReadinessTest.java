package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class EvaluationReadinessTest {
 @Test void incompleteContradictoryOrExtendedWorkerResponseFailsClosed(){
  var mapper=new ObjectMapper();var value=mapper.createObjectNode().put("contract","agenttrust-worker-readiness-v1").put("ready",true).put("fixedConsumerReady",true).put("referenceConsumerReady",true).put("queueReady",true);
  assertTrue(EvaluationReadiness.validWorker(value));
  for(String key:java.util.List.of("ready","fixedConsumerReady","referenceConsumerReady","queueReady")){
   assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put(key,false)));
   assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put(key,"true")));
   var missing=value.deepCopy();missing.remove(key);assertFalse(EvaluationReadiness.validWorker(missing));
  }
  assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put("extra","private")));
  assertFalse(EvaluationReadiness.validWorker(value.deepCopy().put("contract","other")));
 }
}
