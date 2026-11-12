package dev.agenttrust.core;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Immutable recorded observations; never a connector URL, tool call or editable policy. */
public final class ConnectorDefinition {
    public static final String CONTRACT="recorded-connector-rules-v1";
    static final String CASE_CONTRACT="recorded-connector-case-v1";
    private ConnectorDefinition(){}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Invalid connector definition");}
    private static Set<String> names(JsonNode value){if(value==null||!value.isObject())throw invalid();var keys=new HashSet<String>();value.fieldNames().forEachRemaining(keys::add);return keys;}
    private static void fields(JsonNode value,Set<String> required,Set<String> optional){var keys=names(value);if(!keys.containsAll(required)||keys.stream().anyMatch(k->!required.contains(k)&&!optional.contains(k)))throw invalid();}
    private static void fields(JsonNode value,String... expected){fields(value,Set.of(expected),Set.of());}
    private static String text(JsonNode value,int max,boolean nonempty){if(value==null||!value.isTextual())throw invalid();RecordedTextDefinition.text(value.textValue(),max,nonempty);return value.textValue();}
    private static String id(JsonNode value){String id=text(value,64,true);if(!id.matches("[a-z][a-z0-9-]{0,63}"))throw invalid();return id;}
    private static String key(String value){if(value==null||!value.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")||List.of("constructor","prototype","__proto__").contains(value))throw invalid();return value;}
    private static boolean required(JsonNode value){if(!value.path("required").isBoolean())throw invalid();return value.path("required").booleanValue();}
    private static int limit(JsonNode value,String name,int fallback){if(!value.has(name))return fallback;var n=value.path(name);if(!n.isIntegralNumber()||!n.canConvertToInt()||n.intValue()<0||n.intValue()>512)throw invalid();return n.intValue();}
    static void flatSchema(JsonNode value){
        fields(value,"type","properties","required","additionalProperties");
        if(!value.path("type").asText().equals("object")||!value.path("additionalProperties").isBoolean()||value.path("additionalProperties").booleanValue())throw invalid();
        var props=value.path("properties");var required=value.path("required");if(!props.isObject()||props.size()>8||!required.isArray()||required.size()>8)throw invalid();
        var entries=props.fields();while(entries.hasNext()){
            var entry=entries.next();key(entry.getKey());var schema=entry.getValue();fields(schema,Set.of("type"),Set.of("enum","minLength","maxLength"));
            if(!schema.path("type").asText().equals("string")||limit(schema,"minLength",0)>limit(schema,"maxLength",512))throw invalid();
            if(schema.has("enum")){var options=schema.path("enum");if(!options.isArray()||options.isEmpty()||options.size()>8)throw invalid();var seen=new HashSet<String>();for(var option:options)if(!seen.add(text(option,128,false)))throw invalid();}
        }
        var seen=new HashSet<String>();for(var name:required){String k=text(name,64,true);if(!props.has(k)||!seen.add(k))throw invalid();}
    }
    static boolean schemaMatches(JsonNode schema,JsonNode data){
        flatSchema(schema);if(data==null||!data.isObject()||data.size()>8)return false;
        for(var name:schema.path("required"))if(!data.has(name.asText()))return false;
        var entries=data.fields();while(entries.hasNext()){
            var entry=entries.next();if(!schema.path("properties").has(entry.getKey())||!entry.getValue().isTextual())return false;
            String value=entry.getValue().textValue();try{RecordedTextDefinition.text(value,512,false);}catch(IllegalArgumentException invalid){return false;}
            var declared=schema.path("properties").path(entry.getKey());int length=value.codePointCount(0,value.length());if(length<limit(declared,"minLength",0)||length>limit(declared,"maxLength",512))return false;
            if(declared.has("enum")){boolean found=false;for(var option:declared.path("enum"))found|=option.textValue().equals(value);if(!found)return false;}
        }
        return true;
    }
    private static void observation(JsonNode value){
        fields(value,"output","toolEvents");if(!value.path("output").isNull())text(value.path("output"),512,false);
        var events=value.path("toolEvents");if(events.isNull())return;if(!events.isArray()||events.size()>4)throw invalid();
        for(var event:events){fields(event,"name","args");if(!event.path("name").isNull())text(event.path("name"),64,false);var args=event.path("args");if(!args.isNull()){if(!args.isObject()||args.size()>8)throw invalid();var entries=args.fields();while(entries.hasNext()){var entry=entries.next();key(entry.getKey());text(entry.getValue(),128,false);}}}
    }
    @SuppressWarnings("unchecked") static Map<String,Object> caseDefinition(ObjectMapper mapper,JsonNode value){
        fields(value,"id","scenario","required","input","evidence","rules");id(value.path("id"));required(value);text(value.path("input"),512,false);if(!value.path("scenario").asText().equals("quality"))throw invalid();observation(value.path("evidence"));
        var rules=value.path("rules");if(!rules.isArray()||rules.isEmpty()||rules.size()>4)throw invalid();boolean anyRequired=false;var ids=new HashSet<String>();
        for(var rule:rules){if(!ids.add(id(rule.path("id"))))throw invalid();anyRequired|=required(rule);String type=text(rule.path("type"),13,true);
            switch(type){
                case "contains","not_contains"->{fields(rule,"id","type","required","value");text(rule.path("value"),64,true);}
                case "json_schema"->{fields(rule,"id","type","required","schema");flatSchema(rule.path("schema"));}
                case "allowed_tools"->{
                    fields(rule,Set.of("id","type","required","allowed"),Set.of("argumentSchemas"));var allowed=rule.path("allowed");if(!allowed.isArray()||allowed.size()>4)throw invalid();var tools=new HashSet<String>();for(var name:allowed)if(!tools.add(key(text(name,64,true))))throw invalid();
                    if(rule.has("argumentSchemas")){var entries=rule.path("argumentSchemas");if(!entries.isObject())throw invalid();var schemas=entries.fields();while(schemas.hasNext()){var entry=schemas.next();if(!tools.contains(entry.getKey()))throw invalid();flatSchema(entry.getValue());}}
                }
                default->throw invalid();
            }
        }
        if(!anyRequired)throw invalid();Map<String,Object> result=mapper.convertValue(value,Map.class);if(RecordedTextDefinition.json(mapper,result).getBytes(StandardCharsets.UTF_8).length>3072)throw invalid();return result;
    }
    static String dataset(ObjectMapper mapper,JsonNode values){
        if(values==null||!values.isArray()||values.isEmpty()||values.size()>2)throw invalid();var result=new ArrayList<Map<String,Object>>();var ids=new HashSet<String>();boolean required=false;
        for(var value:values){var c=caseDefinition(mapper,value);if(!ids.add((String)c.get("id")))throw invalid();required|=(Boolean)c.get("required");result.add(c);}
        if(!required)throw invalid();String json=RecordedTextDefinition.json(mapper,Map.of("contract",CONTRACT,"cases",result));if(json.getBytes(StandardCharsets.UTF_8).length>6144)throw invalid();return json;
    }
    static Map<String,Object> sample(ObjectMapper mapper,JsonNode value){var body=Map.of("contract",CASE_CONTRACT,"case",caseDefinition(mapper,value));return Map.of("contract",CASE_CONTRACT,"case",body.get("case"),"contentSha256",ArchiveIntegrity.sha256(RecordedTextDefinition.json(mapper,body).getBytes(StandardCharsets.UTF_8)));}
    private static JsonNode snapshot(ObjectMapper mapper){try(var input=ConnectorDefinition.class.getResourceAsStream("/connector-execution-profile.json")){return mapper.readTree(input);}catch(Exception error){throw new IllegalStateException("Connector profile unavailable");}}
    static void validateProfile(ObjectMapper mapper,JsonNode value,String hash){
        var template=snapshot(mapper).path("definition");if(!names(value).equals(names(template)))throw invalid();
        var entries=template.fields();while(entries.hasNext()){var entry=entries.next();String name=entry.getKey();if(!List.of("sourceSha256","validatorProfileSha256").contains(name)&&!entry.getValue().equals(value.path(name)))throw invalid();}
        if(!names(value.path("sourceSha256")).equals(names(template.path("sourceSha256"))))throw invalid();for(var h:value.path("sourceSha256"))if(!text(h,64,true).matches("[a-f0-9]{64}"))throw invalid();
        if(!text(value.path("validatorProfileSha256"),64,true).matches("[a-f0-9]{64}")||hash==null||!hash.matches("[a-f0-9]{64}")||!hash.equals(ArchiveIntegrity.sha256(RecordedTextDefinition.json(mapper,mapper.convertValue(value,Object.class)).getBytes(StandardCharsets.UTF_8))))throw invalid();
    }
    static String agent(ObjectMapper mapper,String provider,String description){
        if(!"synthetic".equals(provider))throw invalid();RecordedTextDefinition.text(description,300,false);var entry=snapshot(mapper);var profile=entry.path("definition");String hash=entry.path("contentSha256").asText();validateProfile(mapper,profile,hash);
        return RecordedTextDefinition.json(mapper,Map.of("contract",CONTRACT,"provider",provider,"description",description,"executionProfile",mapper.convertValue(profile,Object.class),"executionProfileSha256",hash));
    }
    private static String status(ObjectMapper mapper,JsonNode rule,JsonNode evidence){
        String type=rule.path("type").asText();
        if(type.equals("allowed_tools")){
            var events=evidence.path("toolEvents");if(events.isNull())return "inconclusive";
            for(var event:events){if(event.path("name").isNull()||event.path("args").isNull())return "inconclusive";String name=event.path("name").asText();boolean allowed=false;for(var tool:rule.path("allowed"))allowed|=tool.asText().equals(name);if(!allowed)return "fail";var schema=rule.path("argumentSchemas").path(name);if(!schema.isMissingNode()&&!schemaMatches(schema,event.path("args")))return "fail";}return "pass";
        }
        var output=evidence.path("output");if(output.isNull())return "inconclusive";
        if(type.equals("contains")||type.equals("not_contains")){boolean present=output.asText().contains(rule.path("value").asText());return present==type.equals("contains")?"pass":"fail";}
        try{var strict=mapper.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);return schemaMatches(rule.path("schema"),strict.readTree(output.textValue()))?"pass":"fail";}catch(Exception invalid){return "fail";}
    }
    static void validateResult(ObjectMapper mapper,JsonNode value,Evaluation.Result result){
        WorkerClient.validated(result);if(!result.executionEngine().equals("python-synthetic"))throw invalid();if(result.state().equals("failed")){if(!result.equals(unavailable()))throw invalid();return;}
        caseDefinition(mapper,value);var rules=new ArrayList<Evaluation.Rule>();boolean fail=false,missing=false;
        for(var rule:value.path("rules")){String status=status(mapper,rule,value.path("evidence"));boolean required=rule.path("required").booleanValue();fail|=required&&status.equals("fail");missing|=required&&status.equals("inconclusive");rules.add(new Evaluation.Rule(rule.path("id").asText(),required,status,"Recorded connector "+rule.path("type").asText()+" rule evaluated."));}
        if(!result.equals(new Evaluation.Result("succeeded",fail?"block":missing?"inconclusive":"pass",rules,"python-synthetic")))throw invalid();
    }
    static Evaluation.Result unavailable(){return new Evaluation.Result("failed","inconclusive",List.of(new Evaluation.Rule("recorded-connector-execution",true,"inconclusive","Recorded connector evaluation was unavailable.")),"python-synthetic");}
}
