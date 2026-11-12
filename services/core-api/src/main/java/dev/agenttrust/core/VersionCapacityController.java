package dev.agenttrust.core;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
@RestController
public class VersionCapacityController {
 private final VersionCapacity capacity;
 public VersionCapacityController(VersionCapacity capacity){this.capacity=capacity;}
 @GetMapping("/api/version-capacity") VersionCapacity.Snapshot read(@AuthenticationPrincipal DemoUser user){return capacity.read(user);}
}
