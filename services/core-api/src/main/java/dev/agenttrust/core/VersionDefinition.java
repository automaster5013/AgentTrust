package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** A bounded evaluation contract, never an executable agent or caller-controlled URL. */
public final class VersionDefinition {
    public static final String CONTRACT="fixed-scenarios-v1";
    public record Case(String id,String scenario,Boolean required) {}
    static void coordinate(String key,Integer version) {
        if(key==null||!key.matches("[a-z][a-z0-9-]{2,63}")||version==null||version<1||version>1000000)
            throw new IllegalArgumentException("Invalid version coordinate");
    }
    static String agent(ObjectMapper mapper,String provider,String description) {
        if(provider==null||!List.of("synthetic","ollama","openai-compatible").contains(provider)||description==null||description.length()>300)
            throw new IllegalArgumentException("Invalid agent definition");
        var profile=ExecutionProfiles.profile(mapper,provider);return json(mapper,Map.of("contract","fixed-scenarios-v2","provider",provider,"description",description,"executionProfile",profile.get("definition"),"executionProfileSha256",profile.get("contentSha256")));
    }
    static String dataset(ObjectMapper mapper,List<Case> cases) {
        if(cases==null||cases.isEmpty()||cases.size()>8)throw new IllegalArgumentException("Invalid case count");
        var ids=new HashSet<String>();boolean required=false;
        var values=new java.util.ArrayList<Map<String,Object>>();
        for(var item:cases) {
            if(item==null||item.id()==null||!item.id().matches("[a-z][a-z0-9-]{0,63}")||!ids.add(item.id())||item.scenario()==null||!List.of("pass","block","missing_evidence","error").contains(item.scenario())||item.required()==null)
                throw new IllegalArgumentException("Invalid dataset case");
            required|=item.required();
            values.add(new TreeMap<>(Map.of("id",item.id(),"scenario",item.scenario(),"required",item.required())));
        }
        if(!required)throw new IllegalArgumentException("Required case missing");
        return json(mapper,Map.of("contract",CONTRACT,"cases",values));
    }
    private static String json(ObjectMapper mapper,Map<String,?> value) {
        try{return mapper.writeValueAsString(new TreeMap<>(value));}
        catch(Exception error){throw new IllegalStateException("Version content unavailable");}
    }
}
