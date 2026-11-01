package dev.agenttrust.core;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class RunHistorySearchCursorTest {
 private final UUID org=UUID.randomUUID(),project=UUID.randomUUID(),id=UUID.randomUUID();
 private final DemoUser user=new DemoUser("viewer","unused",org,project,id,"viewer");
 private final RunHistoryCursor boundary=new RunHistoryCursor(org,project,Instant.parse("2026-11-01T08:00:00.123456Z"),id);
 private final RunHistoryFilters all=new RunHistoryFilters("all","all","all","all","all");
 @Test void everyConditionAndTenantAreBoundToThePreciseBoundary(){
  String token=RunHistorySearchCursor.encode(boundary,all);assertEquals(128,token.length());assertEquals(boundary,RunHistorySearchCursor.decode(token,user,all));
  for(var changed:new RunHistoryFilters[]{new RunHistoryFilters("quality","all","all","all","all"),new RunHistoryFilters("all","required","all","all","all"),new RunHistoryFilters("all","all","failed","all","all"),new RunHistoryFilters("all","all","all","pass","all"),new RunHistoryFilters("all","all","all","all","ollama")})assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(token,user,changed));
  assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(token,new DemoUser("foreign","unused",UUID.randomUUID(),project,id,"admin"),all));
  assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(token,new DemoUser("foreign","unused",org,UUID.randomUUID(),id,"admin"),all));
 }
 @Test void unrelatedDomainsPaddingSchemaAndSubmicrosecondNavigationAreRefused(){
  String token=RunHistorySearchCursor.encode(boundary,all);
  for(String invalid:new String[]{boundary.encode(),token+"=",token.substring(1),"!"+token.substring(1)})assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(invalid,user,all));
  for(int offset:new int[]{0,1,32,33}){byte[] raw=Base64.getUrlDecoder().decode(token);raw[offset]^=1;String invalid=Base64.getUrlEncoder().withoutPadding().encodeToString(raw);assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(invalid,user,all));}
  String fractional=RunHistorySearchCursor.encode(new RunHistoryCursor(org,project,Instant.parse("2026-11-01T08:00:00.123456001Z"),id),all);assertThrows(IllegalArgumentException.class,()->RunHistorySearchCursor.decode(fractional,user,all));
 }
 @Test void arbitraryInputCannotBecomeSqlOrInventedFilterSemantics(){
  for(String invalid:new String[]{"","ALL","../../runs","pass' OR 1=1",null})assertThrows(IllegalArgumentException.class,()->new RunHistoryFilters(invalid,"all","all","all","all"));
  assertThrows(IllegalArgumentException.class,()->new RunHistoryFilters("all","approved","all","all","all"));
  assertThrows(IllegalArgumentException.class,()->new RunHistoryFilters("all","all","cancelled","all","all"));
  assertThrows(IllegalArgumentException.class,()->new RunHistoryFilters("all","all","all","approved","all"));
  assertThrows(IllegalArgumentException.class,()->new RunHistoryFilters("all","all","all","all","external-url"));
 }
}
