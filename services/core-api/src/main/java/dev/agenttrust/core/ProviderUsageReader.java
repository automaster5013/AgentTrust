package dev.agenttrust.core;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Reservations are not measured billable tokens or proof that inference occurred. */
@Service
public class ProviderUsageReader {
    private final RunService runs;private final JdbcTemplate jdbc;
    public ProviderUsageReader(RunService runs,JdbcTemplate jdbc){this.runs=runs;this.jdbc=jdbc;}
    public record Provider(String provider,long reservedAttempts,long succeededRuns,long failedRuns,long pendingRuns){}
    public record Usage(UUID organizationId,UUID projectId,String budgetDay,String timeZone,Instant observedAt,int dailyLimit,long reservedAttempts,long remainingAttempts,List<Provider> providers,String countingBasis,boolean billableUsageMeasured,boolean deploymentAuthority){}
    public Usage read(DemoUser user){return runs.scoped(user,()->{
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0)) IS NULL",Boolean.class,"provider-budget/"+user.organizationId()+"/"+user.projectId());
        String day=jdbc.queryForObject("SELECT ((now() AT TIME ZONE 'UTC')::date)::text",String.class);
        var providers=List.of("ollama","openai","openai-compatible").stream().map(provider->jdbc.queryForObject("SELECT count(*) AS reserved,count(*) FILTER(WHERE c.state='succeeded') AS succeeded,count(*) FILTER(WHERE c.state='failed') AS failed,count(*) FILTER(WHERE c.run_id IS NULL) AS pending FROM stack_provider_attempts a LEFT JOIN stack_run_results c ON c.run_id=a.run_id WHERE a.organization_id=? AND a.project_id=? AND a.budget_day=?::date AND a.provider=?",(row,index)->new Provider(provider,row.getLong("reserved"),row.getLong("succeeded"),row.getLong("failed"),row.getLong("pending")),user.organizationId(),user.projectId(),day,provider)).toList();
        long total=providers.stream().mapToLong(Provider::reservedAttempts).sum();
        return new Usage(user.organizationId(),user.projectId(),day,"UTC",Instant.now(),ProviderBudget.DAILY_LIMIT,total,Math.max(0,ProviderBudget.DAILY_LIMIT-total),providers,"immutable-provider-reservations",false,false);
    });}
}
