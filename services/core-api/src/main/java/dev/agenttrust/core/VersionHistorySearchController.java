package dev.agenttrust.core;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
@RestController
@RequestMapping("/api/version-history-search/{kind:agents|datasets}/{resourceKey}")
public class VersionHistorySearchController {
 private final VersionHistoryReader reader;
 public VersionHistorySearchController(VersionHistoryReader reader){this.reader=reader;}
 @GetMapping VersionHistoryReader.SearchPage first(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable String resourceKey,HttpServletRequest request){return search(user,kind,resourceKey,null,request);}
 @GetMapping("/{cursor}") VersionHistoryReader.SearchPage next(@AuthenticationPrincipal DemoUser user,@PathVariable String kind,@PathVariable String resourceKey,@PathVariable String cursor,HttpServletRequest request){return search(user,kind,resourceKey,cursor,request);}
 private VersionHistoryReader.SearchPage search(DemoUser user,String kind,String name,String token,HttpServletRequest request){
  if(request.getQueryString()!=null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
  try{return reader.search(user,kind,name,token);}catch(IllegalArgumentException error){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
 }
}
