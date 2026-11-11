package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class RegisteredCatalogController {
 private final RegisteredCatalog catalog;
 public RegisteredCatalogController(RegisteredCatalog catalog){this.catalog=catalog;}
 @GetMapping("/api/catalog") RegisteredCatalog.Catalog read(@AuthenticationPrincipal DemoUser user){return catalog.read(user);}
}
