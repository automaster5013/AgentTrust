package system.authz
import rego.v1
default allow := false
allow if {
    input.method == "GET"
    input.path == ["health"]
}
allow if {
    input.method == "POST"
    input.path == ["v1", "data", "agenttrust", "release", "decision"]
    input.identity == data.stack_auth.token
}
