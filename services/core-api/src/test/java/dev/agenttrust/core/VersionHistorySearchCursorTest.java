package dev.agenttrust.core;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class VersionHistorySearchCursorTest {
 private static final UUID ORG=UUID.fromString("11111111-1111-4111-8111-111111111111"),PROJECT=UUID.fromString("22222222-2222-4222-8222-222222222222"),ID=UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
 private static final DemoUser USER=new DemoUser("reader","unused",ORG,PROJECT,ID,"viewer");
 @Test void exactNameKindScopeAndMicrosecondsAreBound(){
  for(String kind:new String[]{"agents","datasets"}){
   var edge=new VersionHistoryCursor(kind,ORG,PROJECT,Instant.parse("2026-11-03T04:00:00.123456Z"),ID);String token=VersionHistorySearchCursor.encode(edge,"agent-test");
   assertEquals(128,token.length());assertEquals(edge,VersionHistorySearchCursor.decode(token,USER,kind,"agent-test"));
   assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.decode(token,USER,kind,"agent-other"));
   assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.decode(token,USER,kind.equals("agents")?"datasets":"agents","agent-test"));
   for(DemoUser foreign:new DemoUser[]{new DemoUser("other","unused",UUID.randomUUID(),PROJECT,ID,"admin"),new DemoUser("other","unused",ORG,UUID.randomUUID(),ID,"viewer")})assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.decode(token,foreign,kind,"agent-test"));
   for(String invalid:new String[]{token+"=",token.substring(1),edge.encode(),"!"+token.substring(1)})assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.decode(invalid,USER,kind,"agent-test"));
  }
 }
 @Test void nameGrammarNeverAcceptsSqlOrPathFragments(){for(String name:new String[]{"ab","AGENT","a/b","agent%2Fother","agent?x=1","agent' OR true--","a".repeat(65),""})assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.key(name));assertThrows(IllegalArgumentException.class,()->VersionHistorySearchCursor.key(null));assertEquals("all",VersionHistorySearchCursor.key("all"));}
}
