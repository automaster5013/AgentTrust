package dev.agenttrust.core;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ConnectorDefinitionTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private JsonNode cases()throws Exception{try(var input=getClass().getResourceAsStream("/connector-cases.json")){return mapper.readTree(input).path("cases");}}
    private Evaluation.Result result(JsonNode c,String... statuses){
        var rules=new ArrayList<Evaluation.Rule>();boolean fail=false,missing=false;int i=0;
        for(var rule:c.path("rules")){String status=statuses[i++];boolean required=rule.path("required").asBoolean();fail|=required&&status.equals("fail");missing|=required&&status.equals("inconclusive");rules.add(new Evaluation.Rule(rule.path("id").asText(),required,status,"Recorded connector "+rule.path("type").asText()+" rule evaluated."));}
        return new Evaluation.Result("succeeded",fail?"block":missing?"inconclusive":"pass",rules,"python-synthetic");
    }
    @Test void allFiveSampleRulesBindActualObservedEvidence()throws Exception{
        var values=cases();assertNotNull(ConnectorDefinition.dataset(mapper,values));
        ConnectorDefinition.validateResult(mapper,values.get(0),result(values.get(0),"pass","pass","pass"));ConnectorDefinition.validateResult(mapper,values.get(1),result(values.get(1),"pass","pass"));
        var bad=values.get(0).deepCopy();((ObjectNode)bad.path("evidence").path("toolEvents").get(0).path("args")).remove("orderId");ConnectorDefinition.validateResult(mapper,bad,result(bad,"pass","pass","fail"));assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.validateResult(mapper,bad,result(bad,"pass","pass","pass")));
        var missing=values.get(0).deepCopy();((ObjectNode)missing.path("evidence")).putNull("toolEvents");ConnectorDefinition.validateResult(mapper,missing,result(missing,"pass","pass","inconclusive"));
        var empty=values.get(0).deepCopy();((ObjectNode)empty.path("evidence")).set("toolEvents",mapper.createArrayNode());ConnectorDefinition.validateResult(mapper,empty,result(empty,"pass","pass","pass"));
    }
    @Test void jsonSchemaUsesFlatStringObjectsStrictJsonAndCodePointLengths()throws Exception{
        for(String output:List.of("[]","null","{}","{\"status\":1}","{\"status\":\"wrong\",\"status\":\"review_required\"}","{\"status\":\"wrong\",\"st\\u0061tus\":\"review_required\"}","{\"status\":\"review_required\"} trailing")){
            var c=cases().get(1).deepCopy();((ObjectNode)c.path("evidence")).put("output",output);ConnectorDefinition.validateResult(mapper,c,result(c,"fail","pass"));
        }
        var c=cases().get(1).deepCopy();((ObjectNode)c.path("rules").get(0).path("schema").path("properties")).set("status",mapper.readTree("{\"type\":\"string\",\"minLength\":1,\"maxLength\":1}"));
        ((ObjectNode)c.path("evidence")).put("output","{\"status\":\"😀\"}");ConnectorDefinition.validateResult(mapper,c,result(c,"pass","pass"));
        ((ObjectNode)c.path("evidence")).put("output","{\"status\":\"e\u0301\"}");ConnectorDefinition.validateResult(mapper,c,result(c,"fail","pass"));
    }
    @Test void unsupportedSchemaAndMixedFieldsCannotBecomeRegisteredVersions()throws Exception{
        var schema=cases().get(1).path("rules").get(0).path("schema");
        for(String key:List.of("$ref","pattern","allOf","format")){var bad=schema.deepCopy();((ObjectNode)bad).put(key,"unsupported");assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.flatSchema(bad));}
        var bad=schema.deepCopy();((ObjectNode)bad.path("properties").path("status")).put("type","number");assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.flatSchema(bad));
        var c=cases().get(0).deepCopy();((ObjectNode)c).put("output","wrong-contract");assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.caseDefinition(mapper,c));
        assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.dataset(mapper,mapper.createArrayNode()));
        assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.agent(mapper,"ollama","fixture"));
    }
    @Test void newProfileHashesVerifierAndSourcesWithoutChangingAcceptedContracts()throws Exception{
        String json=ConnectorDefinition.agent(mapper,"synthetic","fixture"),hash=ArchiveIntegrity.sha256(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));assertNotNull(ExecutionProfiles.binding(mapper,json,hash));
        var profile=mapper.readTree(json).path("executionProfile").deepCopy();((ObjectNode)profile).put("providerCallsAllowed",true);assertThrows(IllegalArgumentException.class,()->ConnectorDefinition.validateProfile(mapper,profile,"a".repeat(64)));
        var sample=ConnectorDefinition.sample(mapper,cases().get(0));var changed=cases().get(0).deepCopy();((ObjectNode)changed.path("evidence").path("toolEvents").get(0).path("args")).put("orderId","changed");assertNotEquals(sample.get("contentSha256"),ConnectorDefinition.sample(mapper,changed).get("contentSha256"));
        ConnectorDefinition.validateResult(mapper,cases().get(0),ConnectorDefinition.unavailable());
    }
}
