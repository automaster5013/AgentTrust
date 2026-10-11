package dev.agenttrust.core;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
/** Bounded caller data, never executable code, a provider URL or a model setting. */
public final class QualityDefinition {
 public static final String CONTRACT="reference-answer-v1";
 private QualityDefinition(){}
 private static boolean whitespace(int value){return value>=0x9&&value<=0xd||value==0x20||value==0xa0||value==0x1680||value>=0x2000&&value<=0x200a||value==0x2028||value==0x2029||value==0x202f||value==0x205f||value==0x3000||value==0xfeff;}
 static void text(String value,int bytes){if(value==null||value.codePoints().allMatch(QualityDefinition::whitespace)||value.indexOf(0)>=0||value.getBytes(StandardCharsets.UTF_8).length>bytes)throw new IllegalArgumentException("Invalid reference sample");for(int i=0;i<value.length();i++){char c=value.charAt(i);if(Character.isHighSurrogate(c)){if(++i>=value.length()||!Character.isLowSurrogate(value.charAt(i)))throw new IllegalArgumentException("Invalid Unicode sample");}else if(Character.isLowSurrogate(c))throw new IllegalArgumentException("Invalid Unicode sample");}}
 static String agent(ObjectMapper mapper,String provider,String description){
  if(!List.of("ollama","openai-compatible").contains(provider)||description==null||description.length()>300)throw new IllegalArgumentException("Invalid reference agent");
  var profile=profile(mapper,provider);
  return json(mapper,Map.of("contract",CONTRACT,"provider",provider,"description",description,"executionProfile",profile.get("definition"),"executionProfileSha256",profile.get("contentSha256")));
 }
 static Map<String,Object> profile(ObjectMapper mapper,String provider){
  if(!List.of("ollama","openai-compatible").contains(provider))throw new IllegalArgumentException("Invalid reference provider");
  try(var input=QualityDefinition.class.getResourceAsStream("/quality-execution-profiles.json")){
   var entry=mapper.readTree(input).path(provider);var definition=entry.path("definition");String hash=entry.path("contentSha256").asText();
   if(!hash.matches("[a-f0-9]{64}")||!definition.path("contract").asText().equals("reference-execution-profile-v1")||!definition.path("provider").asText().equals(provider)||!hash.equals(ArchiveIntegrity.sha256(mapper.writeValueAsBytes(ExecutionProfiles.canonical(mapper.convertValue(definition,Object.class))))))throw new IllegalStateException("Reference profile unavailable");
   return Map.of("definition",definition,"contentSha256",hash);
  }catch(Exception error){throw new IllegalStateException("Reference profile unavailable");}
 }
 static String dataset(ObjectMapper mapper,List<VersionDefinition.Case> cases){
  if(cases==null||cases.isEmpty()||cases.size()>2)throw new IllegalArgumentException("Invalid reference case count");
  var ids=new HashSet<String>();boolean required=false;var values=new ArrayList<Map<String,Object>>();
  for(var item:cases){
   if(item==null||item.id()==null||!item.id().matches("[a-z][a-z0-9-]{0,63}")||!ids.add(item.id())||!"quality".equals(item.scenario())||item.required()==null)throw new IllegalArgumentException("Invalid reference case");
   text(item.input(),192);text(item.expected(),128);required|=item.required();
   values.add(new TreeMap<>(Map.of("id",item.id(),"scenario","quality","required",item.required(),"input",item.input(),"expected",item.expected())));
  }
  if(!required)throw new IllegalArgumentException("Required reference case missing");
  return json(mapper,Map.of("contract",CONTRACT,"cases",values));
 }
 static Map<String,String> sample(ObjectMapper mapper,String input,String expected){text(input,192);text(expected,128);String hash=ArchiveIntegrity.sha256(json(mapper,Map.of("contract","reference-answer-case-v1","input",input,"expected",expected)).getBytes(StandardCharsets.UTF_8));return Map.of("input",input,"expected",expected,"contentSha256",hash);}
 static String json(ObjectMapper mapper,Map<String,?> value){try{return mapper.writeValueAsString(ExecutionProfiles.canonical(value));}catch(Exception error){throw new IllegalStateException("Reference content unavailable");}}
}
