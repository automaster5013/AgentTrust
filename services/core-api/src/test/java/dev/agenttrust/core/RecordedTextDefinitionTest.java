package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RecordedTextDefinitionTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private ObjectNode sample()throws Exception {
        return (ObjectNode)mapper.readTree("""
            {"id":"refund","scenario":"quality","required":true,"input":"Synthetic question","output":"Synthetic refund needs review.","rules":[
              {"id":"refund-word","type":"contains","required":true,"value":"refund"},
              {"id":"no-transfer","type":"not_contains","required":true,"value":"transfer_funds"}]}
            """);
    }
    @Test void exactFieldsBoundsAndLiteralSemantics()throws Exception {
        var good=sample();assertNotNull(RecordedTextDefinition.dataset(mapper,mapper.createArrayNode().add(good)));
        for(String output:List.of("","é".repeat(256),"환불")) {var value=sample().put("output",output);assertNotNull(RecordedTextDefinition.caseDefinition(mapper,value));}
        for(String output:List.of("é".repeat(257),"x\u0000y","\uD800","\u0001".repeat(512))) {
            var value=sample().put("output",output);assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.caseDefinition(mapper,value));
        }
        var extra=sample().put("toolEvents","untrusted");assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.caseDefinition(mapper,extra));
        var omitted=sample();omitted.remove("output");assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.caseDefinition(mapper,omitted));
        var invalid=sample();((ObjectNode)invalid.path("rules").get(0)).put("type","regex");assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.caseDefinition(mapper,invalid));
        var duplicate=mapper.createArrayNode().add(good).add(good);assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.dataset(mapper,duplicate));
        var noRequired=sample().put("required",false);assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.dataset(mapper,mapper.createArrayNode().add(noRequired)));
    }
    @Test void digestBindsEveryFieldAndOrder()throws Exception {
        var original=RecordedTextDefinition.sample(mapper,sample());
        assertEquals("ba742a16bb6867984245bc937614872afa93d12bed2ce555b547e2e95430f693",original.get("contentSha256"));
        for(String field:List.of("input","output","id"))assertNotEquals(original.get("contentSha256"),RecordedTextDefinition.sample(mapper,sample().put(field,"changed")).get("contentSha256"));
        var value=sample();((ObjectNode)value.path("rules").get(0)).put("value","other");
        assertNotEquals(original.get("contentSha256"),RecordedTextDefinition.sample(mapper,value).get("contentSha256"));
    }
    @Test void completionCannotInventRuleEvidenceOrLeakOriginalTextInReason()throws Exception {
        var success=new Evaluation.Result("succeeded","pass",List.of(
            new Evaluation.Rule("refund-word",true,"pass","Recorded text contains rule passed."),
            new Evaluation.Rule("no-transfer",true,"pass","Recorded text not_contains rule passed.")),"python-synthetic");
        RecordedTextDefinition.validateResult(mapper,sample(),success);
        assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.validateResult(mapper,sample().put("output",""),success));
        var changed=new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("other",true,"pass","invented")),"python-synthetic");
        assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.validateResult(mapper,sample(),changed));
        RecordedTextDefinition.validateResult(mapper,sample(),RecordedTextDefinition.unavailable());
        var inventedFailure=new Evaluation.Result("failed","inconclusive",List.of(new Evaluation.Rule("other",true,"inconclusive","invented")),"python-synthetic");
        assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.validateResult(mapper,sample(),inventedFailure));
    }
}
