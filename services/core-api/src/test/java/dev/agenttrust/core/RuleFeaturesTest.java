package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class RuleFeaturesTest {
 @Test void rejectsForeignMalformedAndUnnormalizedVectors() throws Exception {
  var mapper=new ObjectMapper();UUID run=UUID.randomUUID(),org=UUID.randomUUID(),project=UUID.randomUUID();String hash="a".repeat(64);var vector=new ArrayList<Double>(Collections.nCopies(64,0.0));vector.set(0,1.0);
  var response=new HashMap<String,Object>(Map.of("runId",run.toString(),"organizationId",org.toString(),"projectId",project.toString(),"contentSha256",hash,"featureVersion",RuleFeatures.VERSION,"dimensions",64,"vector",vector));
  assertTrue(RuleFeatures.vector(mapper.valueToTree(response),run,org,project,hash).startsWith("[1.0,"));assertThrows(IllegalArgumentException.class,()->RuleFeatures.vector(mapper.valueToTree(response),run,org,UUID.randomUUID(),hash));
  vector.set(0,0.0);assertThrows(IllegalArgumentException.class,()->RuleFeatures.vector(mapper.valueToTree(response),run,org,project,hash));vector.set(0,2.0);assertThrows(IllegalArgumentException.class,()->RuleFeatures.vector(mapper.valueToTree(response),run,org,project,hash));vector.set(0,1.0);response.put("dimensions","64");assertThrows(IllegalArgumentException.class,()->RuleFeatures.vector(mapper.valueToTree(response),run,org,project,hash));
 }
}
