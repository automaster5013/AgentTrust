package dev.agenttrust.gateway;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.EnumMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/** Subscription-to-result timing with no request-derived metric dimensions. */
@Component
public final class GatewayStageTiming {
    static final String NAME="agenttrust.gateway.stage.duration";
    public enum Stage { IDENTITY, QUOTA, FORWARD }
    private enum Outcome { COMPLETED, ERROR, CANCELLED }
    private final MeterRegistry registry;
    private final EnumMap<Stage,EnumMap<Outcome,Timer>> timers=new EnumMap<>(Stage.class);

    public GatewayStageTiming(MeterRegistry registry) {
        this.registry=registry;
        for(var stage:Stage.values()) {
            var outcomes=new EnumMap<Outcome,Timer>(Outcome.class);
            for(var outcome:Outcome.values()) outcomes.put(outcome,Timer.builder(NAME)
                .tag("agenttrust.gateway.stage",stage.name().toLowerCase(java.util.Locale.ROOT))
                .tag("agenttrust.gateway.outcome",outcome.name().toLowerCase(java.util.Locale.ROOT))
                .serviceLevelObjectives(Duration.ofMillis(5),Duration.ofMillis(25),Duration.ofMillis(100),
                    Duration.ofMillis(250),Duration.ofMillis(500),Duration.ofSeconds(1),Duration.ofSeconds(3),Duration.ofSeconds(6))
                .register(registry));
            timers.put(stage,outcomes);
        }
    }

    public <T> Mono<T> measure(Stage stage,Supplier<Mono<T>> operation) {
        return Mono.defer(()->{
            var sample=Timer.start(registry);
            var recorded=new AtomicBoolean();
            java.util.function.Consumer<Outcome> finish=outcome->{
                if(recorded.compareAndSet(false,true))sample.stop(timers.get(stage).get(outcome));
            };
            return Mono.defer(operation)
                .doOnSuccess(value->finish.accept(Outcome.COMPLETED))
                .doOnError(error->finish.accept(Outcome.ERROR))
                .doOnCancel(()->finish.accept(Outcome.CANCELLED));
        });
    }
}
