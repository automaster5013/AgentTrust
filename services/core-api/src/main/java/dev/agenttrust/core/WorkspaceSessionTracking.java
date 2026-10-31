package dev.agenttrust.core;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WorkspaceSessionTracking implements WebMvcConfigurer {
 private final WorkspaceSessions sessions;
 public WorkspaceSessionTracking(WorkspaceSessions sessions){this.sessions=sessions;}
 @Override public void addInterceptors(InterceptorRegistry registry){registry.addInterceptor(new HandlerInterceptor(){
  @Override public boolean preHandle(HttpServletRequest request,HttpServletResponse response,Object handler){
   var auth=SecurityContextHolder.getContext().getAuthentication();
   if(auth!=null&&auth.isAuthenticated()&&auth.getPrincipal() instanceof DemoUser user)sessions.observe(user,request.getSession(false));return true;
  }
 }).addPathPatterns("/api/**").excludePathPatterns("/api/access-key/project");}
}
