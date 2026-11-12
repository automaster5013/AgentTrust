package dev.agenttrust.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class RecordedTextBindingTest {
    @Test void admittedContentProfileAndRulesBindJobAndCompletionExactly()throws Exception {
        var mapper=new ObjectMapper();var jdbc=mock(JdbcTemplate.class);UUID run=UUID.randomUUID(),campaign=UUID.randomUUID(),agent=UUID.randomUUID(),dataset=UUID.randomUUID();
        var user=new DemoUser("worker","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"viewer");
        var service=new RunService(jdbc,null,mapper,null){@Override <T>T scoped(DemoUser u,Supplier<T> action){return action.get();}};
        var cases=mapper.readTree("""
            [{"id":"ready","scenario":"quality","required":true,"input":"Synthetic input","output":"READY","rules":[{"id":"has-ready","type":"contains","required":true,"value":"READY"}]}]
            """);
        String agentJson=RecordedTextDefinition.agent(mapper,"synthetic","fixture"),agentHash=ArchiveIntegrity.sha256(agentJson.getBytes(StandardCharsets.UTF_8));
        String data=RecordedTextDefinition.dataset(mapper,cases),dataHash=ArchiveIntegrity.sha256(data.getBytes(StandardCharsets.UTF_8));
        String profile=ExecutionProfiles.binding(mapper,agentJson,agentHash);
        var row=new HashMap<String,Object>();row.put("campaign_id",campaign);row.put("case_id","ready");row.put("agent_version_id",agent);row.put("dataset_version_id",dataset);row.put("content_json",agentJson);row.put("content_sha256",agentHash);row.put("admitted_agent_hash",agentHash);row.put("dataset_json",data);row.put("dataset_hash",dataHash);row.put("admitted_dataset_hash",dataHash);row.put("case_index",0);row.put("required",true);
        when(jdbc.queryForList(startsWith("SELECT c.campaign_id"),eq(run))).thenReturn(List.of(row));
        when(jdbc.queryForList(startsWith("SELECT scenario,state"),eq(run),eq(user.organizationId()),eq(user.projectId()))).thenReturn(List.of(Map.of("scenario","quality","state","queued","actor_id",user.actorId(),"provider","synthetic","expired",false)));
        var sample=RecordedTextDefinition.sample(mapper,cases.get(0));
        var correct=new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile,null,sample);
        service.validateBinding(user,run,correct);
        var job=service.job(user,Map.of("id",run,"scenario","quality","provider","synthetic"));
        assertEquals(sample,job.get("recordedCase"));assertFalse(job.containsKey("qualityCase"));assertTrue(mapper.writeValueAsBytes(job).length<=4096);
        for(var binding:List.of(new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile),new RunService.CampaignBinding(campaign,"ready",agent,dataset,"a".repeat(64),null,sample),new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile,Map.of("input","mixed"),sample)))assertThrows(ResponseStatusException.class,()->service.validateBinding(user,run,binding));
        var changed=cases.get(0).deepCopy();((com.fasterxml.jackson.databind.node.ObjectNode)changed).put("output","DENIED");
        assertThrows(ResponseStatusException.class,()->service.validateBinding(user,run,new RunService.CampaignBinding(campaign,"ready",agent,dataset,profile,null,RecordedTextDefinition.sample(mapper,changed))));
        var forged=new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("wrong-rule",true,"pass","invented")),"python-synthetic");
        assertThrows(IllegalArgumentException.class,()->service.complete(user,run,"quality",forged,correct));
        verify(jdbc,never()).update(startsWith("INSERT INTO stack_run_results"),any(),any(),any(),any(),any(),any());
        var result=new Evaluation.Result("succeeded","pass",List.of(new Evaluation.Rule("has-ready",true,"pass","Recorded text contains rule passed.")),"python-synthetic");
        service.complete(user,run,"quality",result,correct);
        verify(jdbc).update(startsWith("INSERT INTO stack_run_results"),eq(run),eq(user.organizationId()),eq(user.projectId()),eq("succeeded"),eq("pass"),anyString());
        row.put("admitted_dataset_hash","b".repeat(64));assertThrows(IllegalStateException.class,()->service.validateBinding(user,run,correct));
    }
    @Test void registrationTypesCannotMixOldAndRecordedCaseFields()throws Exception {
        var mapper=new ObjectMapper();var registry=mock(VersionRegistry.class);var controller=new VersionController(registry,mapper);
        var user=new DemoUser("editor","unused",UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"editor");
        var legacy=List.of(new VersionDefinition.Case("ready","pass",true));
        assertThrows(IllegalArgumentException.class,()->controller.dataset(user,new VersionController.Dataset("sample",1,legacy,"recorded-text-rules",mapper.createArrayNode())));
        assertThrows(IllegalArgumentException.class,()->controller.dataset(user,new VersionController.Dataset("sample",1,legacy,"fixed-scenarios",mapper.createArrayNode())));
        verifyNoInteractions(registry);
        assertThrows(IllegalArgumentException.class,()->RecordedTextDefinition.agent(mapper,"ollama","fixture"));
        assertThrows(IllegalArgumentException.class,()->VersionController.reference("recorded-text-rules"));
    }
}
