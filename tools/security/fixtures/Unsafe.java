import java.net.http.HttpClient;
class Unsafe {
 void configure(HttpSecurity http) {
  http.csrf(config -> config.disable());
  HttpClient.newBuilder().followRedirects(HttpClient.Redirect.ALWAYS);
 }
}
