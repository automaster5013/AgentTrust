package dev.agenttrust.gateway;
import java.time.Duration;
import java.util.List;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
@Service
public class QuotaService {
 static final String LUA="local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local limit=tonumber(ARGV[1]); if n>=limit then return -math.max(redis.call('TTL',KEYS[1]),1) end; n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n";
 private static final DefaultRedisScript<Long> SCRIPT=new DefaultRedisScript<>(LUA,Long.class);
 private final ReactiveStringRedisTemplate redis;
 public QuotaService(ReactiveStringRedisTemplate redis){this.redis=redis;}
 public Mono<Long> admit(String scope,boolean write){return redis.execute(SCRIPT,List.of("stack:quota:"+scope+":"+(write?"write":"read")),List.of(write?"60":"240")).single().timeout(Duration.ofSeconds(2));}
}
