package dev.agenttrust.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Recorded synthetic text only. These rules never invoke a model, regex or caller code. */
public final class RecordedTextDefinition {
    public static final String CONTRACT="recorded-text-rules-v1";
    static final String CASE_CONTRACT="recorded-text-case-v1";
    private RecordedTextDefinition() {}

    static void text(String value,int limit,boolean nonempty) {
        if(value==null||nonempty&&value.isEmpty()||value.indexOf(0)>=0||value.getBytes(StandardCharsets.UTF_8).length>limit)throw invalid();
        for(int i=0;i<value.length();i++) {
            char current=value.charAt(i);
            if(Character.isHighSurrogate(current)) {if(++i>=value.length()||!Character.isLowSurrogate(value.charAt(i)))throw invalid();}
            else if(Character.isLowSurrogate(current))throw invalid();
        }
    }
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Invalid recorded text definition");}
    private static void fields(JsonNode value,String... names) {
        if(value==null||!value.isObject()||value.size()!=names.length)throw invalid();
        var actual=new HashSet<String>();value.fieldNames().forEachRemaining(actual::add);
        if(!actual.equals(Set.of(names)))throw invalid();
    }
    private static String string(JsonNode value,String name,int limit,boolean nonempty) {
        var node=value.path(name);if(!node.isTextual())throw invalid();String result=node.textValue();text(result,limit,nonempty);return result;
    }
    private static String id(JsonNode value) {
        String result=string(value,"id",64,true);if(!result.matches("[a-z][a-z0-9-]{0,63}"))throw invalid();return result;
    }
    private static boolean required(JsonNode value) {if(!value.path("required").isBoolean())throw invalid();return value.path("required").booleanValue();}
    static String json(ObjectMapper mapper,Object value) {
        try{return mapper.writeValueAsString(ExecutionProfiles.canonical(value));}
        catch(Exception error){throw new IllegalStateException("Recorded definition unavailable");}
    }
    private static void bytes(String value,int limit){if(value.getBytes(StandardCharsets.UTF_8).length>limit)throw invalid();}

    static String agent(ObjectMapper mapper,String provider,String description) {
        if(!"synthetic".equals(provider))throw invalid();text(description,300,false);
        try(var input=RecordedTextDefinition.class.getResourceAsStream("/recorded-text-execution-profile.json")) {
            var entry=mapper.readTree(input);var profile=entry.path("definition");String hash=entry.path("contentSha256").asText();
            validateProfile(mapper,profile,hash);
            return json(mapper,Map.of("contract",CONTRACT,"provider",provider,"description",description,"executionProfile",mapper.convertValue(profile,Object.class),"executionProfileSha256",hash));
        }catch(Exception error){throw new IllegalStateException("Recorded execution profile unavailable");}
    }
    static void validateProfile(ObjectMapper mapper,JsonNode profile,String hash) {
        fields(profile,"schemaVersion","contract","provider","sourceSha256","maxCases","maxRulesPerCase","inputUtf8Bytes","outputUtf8Bytes","ruleValueUtf8Bytes","caseJsonBytes","datasetJsonBytes","jobJsonBytes","executionDeadlineSeconds","evaluationTimeoutSeconds","maxAttempts","comparison","arbitraryCodeAllowed","callerSelectedUrlAllowed","providerCallsAllowed");
        var limits=Map.of("schemaVersion",1,"maxCases",2,"maxRulesPerCase",4,"inputUtf8Bytes",512,"outputUtf8Bytes",512,"ruleValueUtf8Bytes",64,"caseJsonBytes",2048,"datasetJsonBytes",4096,"jobJsonBytes",4096);
        for(var entry:limits.entrySet())if(!profile.path(entry.getKey()).isIntegralNumber()||!profile.path(entry.getKey()).canConvertToInt()||profile.path(entry.getKey()).intValue()!=entry.getValue())throw invalid();
        for(var entry:Map.of("executionDeadlineSeconds",120,"evaluationTimeoutSeconds",1,"maxAttempts",1).entrySet())if(!profile.path(entry.getKey()).isIntegralNumber()||!profile.path(entry.getKey()).canConvertToInt()||profile.path(entry.getKey()).intValue()!=entry.getValue())throw invalid();
        if(!profile.path("contract").asText().equals("recorded-text-execution-profile-v1")||!profile.path("provider").asText().equals("synthetic")||!profile.path("comparison").asText().equals("case-sensitive-literal-unmodified-Unicode"))throw invalid();
        for(String name:List.of("arbitraryCodeAllowed","callerSelectedUrlAllowed","providerCallsAllowed"))if(!profile.path(name).isBoolean()||profile.path(name).booleanValue())throw invalid();
        var sources=profile.path("sourceSha256");fields(sources,"recorded_evaluator.py","recorded_worker.py","recorded_application.py","recorded_profiles.py");
        for(var source:sources)if(!source.isTextual()||!source.textValue().matches("[a-f0-9]{64}"))throw invalid();
        if(hash==null||!hash.matches("[a-f0-9]{64}")||!hash.equals(ArchiveIntegrity.sha256(json(mapper,mapper.convertValue(profile,Object.class)).getBytes(StandardCharsets.UTF_8))))throw invalid();
    }

    static Map<String,Object> caseDefinition(ObjectMapper mapper,JsonNode value) {
        fields(value,"id","scenario","required","input","output","rules");
        String caseId=id(value),scenario=string(value,"scenario",7,true);
        if(!scenario.equals("quality"))throw invalid();
        boolean caseRequired=required(value);
        String input=string(value,"input",512,false),output=string(value,"output",512,false);
        var rules=value.path("rules");if(!rules.isArray()||rules.isEmpty()||rules.size()>4)throw invalid();
        var normalized=new ArrayList<Map<String,Object>>();var ids=new HashSet<String>();boolean hasRequired=false;
        for(var rule:rules) {
            fields(rule,"id","type","required","value");String ruleId=id(rule),type=string(rule,"type",12,true);
            if(!ids.add(ruleId)||!List.of("contains","not_contains").contains(type))throw invalid();
            boolean ruleRequired=required(rule);hasRequired|=ruleRequired;
            normalized.add(Map.of("id",ruleId,"type",type,"required",ruleRequired,"value",string(rule,"value",64,true)));
        }
        if(!hasRequired)throw invalid();
        Map<String,Object> result=Map.of("id",caseId,"scenario",scenario,"required",caseRequired,"input",input,"output",output,"rules",List.copyOf(normalized));
        bytes(json(mapper,result),2048);return result;
    }
    static String dataset(ObjectMapper mapper,JsonNode values) {
        if(values==null||!values.isArray()||values.isEmpty()||values.size()>2)throw invalid();
        var cases=new ArrayList<Map<String,Object>>();var ids=new HashSet<String>();boolean hasRequired=false;
        for(var value:values) {
            var item=caseDefinition(mapper,value);if(!ids.add((String)item.get("id")))throw invalid();
            hasRequired|=(Boolean)item.get("required");cases.add(item);
        }
        if(!hasRequired)throw invalid();
        String result=json(mapper,Map.of("contract",CONTRACT,"cases",cases));bytes(result,4096);return result;
    }
    static Map<String,Object> sample(ObjectMapper mapper,JsonNode value) {
        var body=Map.of("contract",CASE_CONTRACT,"case",caseDefinition(mapper,value));
        return Map.of("contract",CASE_CONTRACT,"case",body.get("case"),"contentSha256",ArchiveIntegrity.sha256(json(mapper,body).getBytes(StandardCharsets.UTF_8)));
    }

    /** Check successful worker results against the admitted rules, including optional rule failures. */
    static void validateResult(ObjectMapper mapper,JsonNode value,Evaluation.Result result) {
        WorkerClient.validated(result);
        if(!"python-synthetic".equals(result.executionEngine()))throw invalid();
        if(result.state().equals("failed")) {
            if(!result.equals(unavailable()))throw invalid();
            return;
        }
        var definition=caseDefinition(mapper,value);String output=(String)definition.get("output");
        var expected=new ArrayList<Evaluation.Rule>();boolean failed=false;
        for(var node:mapper.valueToTree(definition).path("rules")) {
            String type=node.path("type").asText();boolean present=output.contains(node.path("value").asText());
            boolean passed=type.equals("contains")?present:!present,required=node.path("required").asBoolean();
            failed|=required&&!passed;
            expected.add(new Evaluation.Rule(node.path("id").asText(),required,passed?"pass":"fail","Recorded text "+type+" rule "+(passed?"passed":"failed")+"."));
        }
        if(!result.equals(new Evaluation.Result("succeeded",failed?"block":"pass",expected,"python-synthetic")))throw invalid();
    }
    static Evaluation.Result unavailable() {
        return new Evaluation.Result("failed","inconclusive",List.of(new Evaluation.Rule("recorded-text-execution",true,"inconclusive","Recorded text evaluation was unavailable.")),"python-synthetic");
    }
}
