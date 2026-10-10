import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
public final class HealthProbe {
    public static void main(String[] args) {
        try {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080/actuator/health")).timeout(Duration.ofSeconds(3)).GET().build();
            var response=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build().send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()!=200||response.body().length()>16384||!response.body().contains("\"status\":\"UP\""))System.exit(1);
        } catch(Exception error) {System.exit(1);}
    }
}
