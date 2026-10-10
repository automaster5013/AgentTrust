package dev.agenttrust.gateway;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.ReactiveHealthIndicator;
import reactor.core.publisher.Mono;
@Configuration
public class GatewayConfiguration {
 @Bean LettuceConnectionFactory redisConnectionFactory() throws Exception {
  var password=Files.readString(Path.of("/run/secrets/stack-redis-token"));if(!password.matches("[a-f0-9]{64}"))throw new IllegalStateException("Redis configuration unavailable");
  var config=new RedisStandaloneConfiguration("stack-redis",6379);config.setUsername("stack-gateway");config.setPassword(password);
  var options=ClientOptions.builder().socketOptions(SocketOptions.builder().connectTimeout(Duration.ofSeconds(1)).build()).build();
  return new LettuceConnectionFactory(config,LettuceClientConfiguration.builder().commandTimeout(Duration.ofSeconds(1)).shutdownTimeout(Duration.ofMillis(100)).clientOptions(options).build());
 }
 @Bean WebClient coreClient(){return WebClient.builder().baseUrl("http://stack-core-api:8080").clientConnector(new ReactorClientHttpConnector(HttpClient.create().followRedirect(false).responseTimeout(Duration.ofSeconds(4)))).codecs(codec->codec.defaultCodecs().maxInMemorySize(1048576)).build();}
 @Bean ReactiveHealthIndicator quotaHealthIndicator(ReactiveRedisConnectionFactory factory){return ()->Mono.usingWhen(Mono.fromSupplier(factory::getReactiveConnection),connection->connection.ping().map(reply->reply.equals("PONG")?Health.up().build():Health.down().build()),connection->connection.closeLater()).timeout(Duration.ofSeconds(2)).onErrorReturn(Health.down().build());}
}
