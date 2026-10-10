import java.net.http.HttpClient;
class Safe {
 void configure(HttpSecurity http) {
  http.csrf(config -> config.csrfTokenRepository(repository));
  HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER);
 }
}
