package dev.agenttrust.core;

import java.util.UUID;
import org.springframework.security.core.userdetails.User;

public class DemoUser extends User {
    private final UUID organizationId;
    private final UUID projectId;
    private final UUID actorId;
    private final String role;
    public DemoUser(String username, String password, UUID organizationId, UUID projectId, UUID actorId, String role) {
        super(username, password, org.springframework.security.core.authority.AuthorityUtils.createAuthorityList("ROLE_" + role.toUpperCase()));
        this.organizationId = organizationId; this.projectId = projectId; this.actorId = actorId; this.role = role;
    }
    public UUID organizationId() { return organizationId; }
    public UUID projectId() { return projectId; }
    public UUID actorId() { return actorId; }
    public String role() { return role; }
}
