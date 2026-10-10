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
import org.springframework.web.reactive.function.client.ExchangeFilterFunction;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.http.HttpMethod;
import reactor.util.retry.Retry;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.ReactiveHealthIndicator;
import reactor.core.publisher.Mono;
@Configuration
public class GatewayConfiguration {
 @Bean LettuceConnectionFactory redisConnectionFactory() throws Exception {
  var password=Files.readString(Path.of("/run/secrets/stack-redis-token"));if(!password.matches("[a-f0-9]{64}"))throw new IllegalStateException("Redis configuration unavailable");
  var config=new RedisStandaloneConfiguration("stack-redis",6379);config.setUsername("stack-gateway");config.setPassword(password);
  var options=ClientOptions.builder().socketOptions(SocketOptions.builder().connectTimeout(Duration.ofSeconds(1)).build()).build();
  return new LettuceConnectionFactory(config,LettuceClientConfiguration.builder().commandTimeout(Duration.ofSeconds(1)).shutdownTimeout(Duration.ofMillis(100)).clientOptions(options).build());
 }
 static ExchangeFilterFunction recoverReads(){return (request,next)->{var response=Mono.defer(()->next.exchange(request));return request.method()==HttpMethod.GET&&request.url().getPath().startsWith("/api/")&&!request.url().getPath().equals("/api/csrf")?response.retryWhen(Retry.max(1).filter(error->error instanceof WebClientRequestException&&error.getCause() instanceof java.io.IOException)):response;};}
 @Bean WebClient coreClient(){var pool=ConnectionProvider.builder("stack-core").maxConnections(32).pendingAcquireTimeout(Duration.ofSeconds(1)).maxIdleTime(Duration.ofSeconds(2)).maxLifeTime(Duration.ofSeconds(30)).evictInBackground(Duration.ofSeconds(1)).build();var http=HttpClient.create(pool).resolver(spec->spec.cacheMaxTimeToLive(Duration.ofSeconds(1)).cacheMinTimeToLive(Duration.ZERO).cacheNegativeTimeToLive(Duration.ZERO).queryTimeout(Duration.ofSeconds(1))).followRedirect(false).responseTimeout(Duration.ofSeconds(4));return WebClient.builder().baseUrl("http://stack-core-api:8080").filter(recoverReads()).clientConnector(new ReactorClientHttpConnector(http)).codecs(codec->codec.defaultCodecs().maxInMemorySize(1048576)).build();}
 @Bean ReactiveHealthIndicator coreHealthIndicator(WebClient coreClient){return ()->coreClient.get().uri("/api/auth-info").exchangeToMono(response->response.releaseBody().thenReturn(response.statusCode().value()==200?Health.up().build():Health.down().build())).timeout(Duration.ofSeconds(2)).onErrorReturn(Health.down().build());}
 @Bean ReactiveHealthIndicator quotaHealthIndicator(ReactiveRedisConnectionFactory factory){return ()->Mono.usingWhen(Mono.fromSupplier(factory::getReactiveConnection),connection->connection.ping().map(reply->reply.equals("PONG")?Health.up().build():Health.down().build()),connection->connection.closeLater()).timeout(Duration.ofSeconds(2)).onErrorReturn(Health.down().build());}
}
