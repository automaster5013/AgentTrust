package dev.agenttrust.core;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignHistorySearchCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),dataset=UUID.randomUUID(),id=UUID.randomUUID();
 private final DemoUser user=new DemoUser("viewer","unused",org,project,id,"viewer");
 private final CampaignHistoryCursor boundary=new CampaignHistoryCursor(org,project,dataset,Instant.parse("2026-11-03T00:00:00.123456Z"),id);
 private final CampaignHistoryFilters all=new CampaignHistoryFilters("all",null);
 @Test void exactConditionsTenantAndDatasetBoundToMicrosecondBoundary(){
  var token=CampaignHistorySearchCursor.encode(boundary,all);assertEquals(151,token.length());assertEquals(boundary,CampaignHistorySearchCursor.decode(token,user,dataset,all));
  for(var changed:new CampaignHistoryFilters[]{new CampaignHistoryFilters("required",null),new CampaignHistoryFilters("all",id)})assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(token,user,dataset,changed));
  assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(token,user,null,all));
  assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(token,new DemoUser("foreign","unused",UUID.randomUUID(),project,id,"admin"),dataset,all));
  assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(token,new DemoUser("foreign","unused",org,UUID.randomUUID(),id,"admin"),dataset,all));
 }
 @Test void paddingDifferentDomainAndSubmicrosecondsAreRejected(){
  var token=CampaignHistorySearchCursor.encode(boundary,all);
  for(var invalid:new String[]{token+"=",token.substring(1),boundary.encode()})assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(invalid,user,dataset,all));
  for(int offset:new int[]{0,1,32,33}){var raw=Base64.getUrlDecoder().decode(token);raw[offset]^=1;var invalid=Base64.getUrlEncoder().withoutPadding().encodeToString(raw);assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(invalid,user,dataset,all));}
  var precise=new CampaignHistoryCursor(org,project,dataset,Instant.parse("2026-11-03T00:00:00.123456001Z"),id);
  assertThrows(IllegalArgumentException.class,()->CampaignHistorySearchCursor.decode(CampaignHistorySearchCursor.encode(precise,all),user,dataset,all));
 }
 @Test void canonicalConditionsOnly(){
  for(var invalid:new String[]{"approved","ALL","../runs","required' OR true"})assertThrows(IllegalArgumentException.class,()->new CampaignHistoryFilters(invalid,null));
  assertNull(CampaignHistoryFilters.optionalId("all"));assertEquals(id,CampaignHistoryFilters.optionalId(id.toString()));
  for(var invalid:new String[]{"1-1-1-1-1",id.toString().toUpperCase(),"../runs"})if(!invalid.equals(id.toString()))assertThrows(IllegalArgumentException.class,()->CampaignHistoryFilters.optionalId(invalid));
 }
}
