package dev.agenttrust.core;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class CampaignAggregateTest {
 private CampaignAggregate.CaseEvidence c(String id,boolean required,String state,String decision){return new CampaignAggregate.CaseEvidence(id,required,UUID.randomUUID(),"pass","synthetic",state,decision);}
 @Test void pendingMissingAndExecutionErrorsNeverOpenGate(){
  for(var unresolved:List.of(c("pending",true,"queued","inconclusive"),c("missing",true,"succeeded","inconclusive"),c("error",false,"failed","inconclusive"))){var result=CampaignAggregate.result(List.of(c("ready",true,"succeeded","pass"),unresolved));assertEquals("inconclusive",result.decision());}
 }
 @Test void requiredFailureBlocksButOptionalFailureDoesNotOverrideRequiredPass(){
  assertEquals("block",CampaignAggregate.result(List.of(c("bad",true,"succeeded","block"))).decision());
  assertEquals("pass",CampaignAggregate.result(List.of(c("ready",true,"succeeded","pass"),c("optional",false,"succeeded","block"))).decision());
  assertEquals("inconclusive",CampaignAggregate.result(List.of(c("only-optional",false,"succeeded","pass"))).decision());
 }
 @Test void comparisonDetectsRegressionAndNeverHasDeploymentAuthority(){
  var comparison=CampaignAggregate.compare(List.of(c("output",true,"succeeded","pass")),List.of(c("output",true,"succeeded","block")));
  assertEquals("regression",comparison.status());assertEquals(List.of("output"),comparison.newlyFailedRequiredCases());assertFalse(comparison.deploymentAuthority());
  assertEquals("inconclusive",CampaignAggregate.compare(List.of(c("output",true,"succeeded","pass")),List.of(c("output",true,"failed","inconclusive"))).status());
  assertThrows(IllegalArgumentException.class,()->CampaignAggregate.compare(List.of(c("output",true,"succeeded","pass")),List.of(c("different",true,"succeeded","pass"))));
 }
}
