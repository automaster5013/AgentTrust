"""Plan, or explicitly execute a portless CI-only real HTTPS identity fixture.

Fresh tmpfs PostgreSQL databases and fresh realm credentials are used. No
original volume, database, identity, trust store or published port is changed.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import sys
import time
import uuid
from stack_https_fixture_diagnostics import public_probe_failure, public_browser_result
from stack_https_fixture_enterprise import build as enterprise_configuration
from stack_https_fixture_pilot import validate_result as validate_pilot_result

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = 'node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1'
CONSOLE = 'agenttrust-stack-console:oidc-endpoint-https-candidate'


def require(condition):
    if not condition:
        raise ValueError('SYNTHETIC_HTTPS_FIXTURE_REFUSED')


def execution_guard(environment):
    require(environment.get('CI') == 'true' and environment.get('GITHUB_ACTIONS') == 'true')
    require(os.name == 'posix' and os.getuid() != 0)


def plan():
    return {'completed': True, 'executed': False, 'privatePortsOnly': True,
        'freshPostgresAndRealmRequired': True, 'actualTlsLoginVerified': False,
        'productionDeploymentPerformed': False, 'sourceServicesModified': False,
        'executionRequires': 'explicit --execute in a nonroot disposable GitHub CI job'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--with-browser', action='store_true')
    parser.add_argument('--with-enterprise-pilot', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps(plan()))
        return 0
    # Refuse before Docker queries, private input creation or any network call.
    execution_guard(os.environ)
    require(not args.with_enterprise_pilot or args.with_browser)
    require(shutil.disk_usage(ROOT).free >= 22 * 1024 ** 3)
    if args.with_browser:
        require(shutil.which('node') is not None and shutil.which('certutil') is not None)
    identifier = str(uuid.uuid4())
    prefix = 'agenttrust-https-fixture-' + identifier
    directory = ROOT / '.local' / ('stack-https-identity-' + identifier)
    directory.mkdir(mode=0o700)
    certificate_dir = directory / 'certificates'
    certificate_dir.mkdir(mode=0o700)
    trust_dir = directory / 'truststore'
    trust_dir.mkdir(mode=0o700)
    owned_files = []
    containers = []
    network_created = False
    before = None
    before_business = None
    report = {'completed': False, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'fixtureId': identifier, 'phase': 'preflight', 'hostPortsPublished': False,
        'originalVolumesMounted': False, 'sourceServicesModified': False,
        'originalCredentialsRead': False, 'productionDeploymentPerformed': False,
        'paidProviderCallsPerformed': False, 'privateInputsPrinted': False,
        'actualTlsLoginVerified': False, 'chromiumRenderingVerified': False,
        'externalEnterpriseIdpVerified': False, 'browserRequested': args.with_browser,
        'enterprisePilotRequested': args.with_enterprise_pilot, 'actualFederatedEvaluationPilotVerified': False}

    def run(command, data=None, timeout=60, environment=None):
        return subprocess.run(command, cwd=ROOT, input=data, capture_output=True, timeout=timeout, env=environment)

    def ok(command, data=None, timeout=60):
        result = run(command, data, timeout)
        if result.returncode:
            report['failedProcessExitCode'] = result.returncode
            raise RuntimeError('SYNTHETIC_HTTPS_PROCESS_UNVERIFIED')
        return result.stdout

    def private_file(name, data, readable=False):
        path = directory / name
        require(path.parent == directory and not path.exists())
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
            stream.write(data if isinstance(data, bytes) else data.encode())
        if readable:
            path.chmod(0o444)  # The owning host directory remains mode0700.
        owned_files.append(path)
        return path

    def envfile(name, values):
        return private_file(name, '\n'.join(k + '=' + v for k, v in values.items()) + '\n')

    def bind(path, target):
        return ['--mount', 'type=bind,source=' + str(path) + ',target=' + target + ',readonly']

    def source_image(service):
        raw = ok(['docker', 'inspect', '--format', '{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Health.Status}}', 'agenttrust-' + service + '-1']).decode().strip()
        image, project, observed_service, health = raw.split('|')
        require(project == 'agenttrust' and observed_service == service and health == 'healthy'
                and re.fullmatch('sha256:[a-f0-9]{64}', image))
        return image

    def runtime():
        names = ok(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=agenttrust']).decode().splitlines()
        require(names)
        return sorted(ok(['docker', 'inspect', '--format', '{{.Id}}|{{.Image}}|{{.RestartCount}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', *names]).decode().splitlines())

    def own(name, cleanup=False):
        raw = ok(['docker', 'inspect', '--format', '{{index .Config.Labels "agenttrust.fixture"}}|{{.State.Status}}|{{.State.OOMKilled}}|{{json .HostConfig.PortBindings}}', name]).decode().strip().split('|')
        require(raw[0] == identifier and raw[3] in ('{}', 'null'))
        if not cleanup:
            require(raw[2] == 'false')
        return raw

    def start(kind, image, extra, command=(), detached=True, memory='512m', timeout=180):
        name = prefix + '-' + kind
        containers.append(name)
        arguments = ['docker', 'run', '--pull', 'never', '--name', name,
            '--label', 'agenttrust.fixture=' + identifier, '--log-driver', 'none',
            '--network', prefix, '--read-only', '--cap-drop', 'ALL', '--security-opt',
            'no-new-privileges:true', '--memory', memory, '--cpus', '1', '--pids-limit', '128',
            '--tmpfs', '/tmp:size=64m,mode=1777']
        if detached:
            arguments.append('-d')
        process = run([*arguments, *extra, image, *command], timeout=timeout)
        if process.returncode:
            report['failedProcessExitCode'] = process.returncode
            if kind in ('probe', 'browser-state', 'pilot'):
                try:
                    report['protocolFailure'] = public_probe_failure(process.stdout)
                except Exception:
                    report['protocolFailureFrameRefused'] = True
            raise RuntimeError('SYNTHETIC_HTTPS_PROCESS_UNVERIFIED')
        output = process.stdout
        state = own(name)
        require(state[1] == ('running' if detached else 'exited'))
        return output

    def sql(query, database='agenttrust_stack'):
        require(database in ('agenttrust_stack', 'agenttrust_stack_identity', 'agenttrust_stack_enterprise'))
        return ok(['docker', 'exec', '-i', prefix + '-db', 'psql', '-U', 'agenttrust_stack',
            '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], query.encode())

    def identity_attributes(database, realm_name, users):
        require((database, realm_name) in (('agenttrust_stack_identity', 'agenttrust'),
            ('agenttrust_stack_enterprise', 'enterprise-synthetic')))
        expected = []
        for user in users:
            require(str(uuid.UUID(user['id'])) == user['id'])
            for name, values in user.get('attributes', {}).items():
                require(name in ('agenttrust_organization', 'agenttrust_project')
                    and isinstance(values, list) and len(values) == 1 and str(uuid.UUID(values[0])) == values[0])
                expected.append("('" + user['id'] + "','" + name + "','" + values[0] + "')")
        require(len(expected) == 8)
        # Read only the new fixture database. Default profile policy may hide
        # unmanaged scopes from admin representations; it is never relaxed.
        query = ("BEGIN READ ONLY;SET LOCAL statement_timeout='2s';WITH observed AS ("
            "SELECT a.user_id::text AS user_id,a.name::text AS name,a.value::text AS value "
            "FROM public.user_attribute a JOIN public.user_entity u ON u.id=a.user_id "
            "JOIN public.realm r ON r.id=u.realm_id WHERE r.name='" + realm_name + "'),"
            "expected(user_id,name,value) AS (VALUES " + ','.join(expected) + "),difference AS ("
            "(SELECT * FROM observed EXCEPT SELECT * FROM expected) UNION ALL "
            "(SELECT * FROM expected EXCEPT SELECT * FROM observed)) "
            "SELECT count(*)::text||'|'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,"
            "E'\\n' ORDER BY user_id,name,value),''),'UTF8')),'hex')||'|'||"
            "(NOT EXISTS(SELECT 1 FROM difference))::text FROM observed t;ROLLBACK;")
        value = sql(query, database).decode().splitlines()[-2]
        require(re.fullmatch(r'8\|[a-f0-9]{64}\|true', value) is not None)
        return value

    try:
        before = runtime()
        from stack_business_fingerprint import fingerprint
        before_business = fingerprint()
        images = {kind: source_image(service) for kind, service in
                  [('core', 'stack-core-api'), ('database', 'stack-db'), ('identity', 'stack-identity')]}
        if args.with_enterprise_pilot:
            images.update({kind: source_image(service) for kind, service in
                [('worker', 'stack-ai-worker'), ('messaging', 'stack-nats'), ('policy', 'stack-opa')]})
        images['console'] = ok(['docker', 'image', 'inspect', '--format', '{{.Id}}', CONSOLE]).decode().strip()
        labels = json.loads(ok(['docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', CONSOLE]))
        require(all(labels.get('dev.agenttrust.oidc.' + k) == v for k, v in {
            'profile': 'https-review', 'application-origin': 'https://console.example.com',
            'public-issuer': 'https://identity.example.com/realms/agenttrust'}.items()))
        images['tools'] = ok(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'agenttrust-security:local']).decode().strip()
        images['edge'] = ok(['docker', 'image', 'inspect', '--format', '{{.Id}}', NODE]).decode().strip()
        report.update(sourceRevision=ok(['git', 'rev-parse', 'HEAD']).decode().strip(), imageIds=images)
        require(labels.get('org.opencontainers.image.revision') == report['sourceRevision'])
        registry_console = os.environ.get('STACK_HTTPS_CONSOLE_IMAGE')
        if registry_console:
            require(re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-console-https@sha256:[a-f0-9]{64}', registry_console))
            require(ok(['docker', 'image', 'inspect', '--format', '{{.Id}}', registry_console]).decode().strip() == images['console'])
        report.update(httpsConsoleSourceRevisionLabelVerified=True, httpsConsoleImageSignatureVerified=False,
            httpsConsoleRegistryImageIdentityVerified=bool(registry_console), httpsConsoleRegistryReference=registry_console)
        owner_password, api_password, identity_password, enterprise_password, client_secret = [secrets.token_hex(32) for _ in range(5)]
        organizations, projects, witnesses = [[str(uuid.uuid4()) for _ in range(2)] for _ in range(3)]
        accounts = [{'username': name, 'password': secrets.token_hex(24), 'role': role,
            'organizationId': organizations[index], 'projectId': projects[index],
            'actorId': str(uuid.uuid4()), 'ownedRunId': witnesses[index]} for name, role, index in
            [('demo-admin', 'admin', 0), ('demo-editor', 'editor', 0), ('demo-viewer', 'viewer', 0), ('other-admin', 'admin', 1)]]
        account_file = private_file('accounts.json', json.dumps(accounts), True)
        administrator_password = secrets.token_hex(32)
        enterprise_administrator_password = secrets.token_hex(32)
        administrator_file = private_file('administrator.json', json.dumps({'password': administrator_password,
            'enterprisePassword': enterprise_administrator_password}), True)
        secret_file = private_file('client-secret', client_secret, True)
        mappers = [{'name': field, 'protocol': 'openid-connect', 'protocolMapper': 'oidc-usermodel-attribute-mapper',
            'config': {'user.attribute': field, 'claim.name': field, 'jsonType.label': 'String',
                'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true'}}
            for field in ('agenttrust_organization', 'agenttrust_project')]
        mappers.append({'name': 'agenttrust_roles', 'protocol': 'openid-connect', 'protocolMapper': 'oidc-usermodel-realm-role-mapper',
            'config': {'claim.name': 'agenttrust_roles', 'multivalued': 'true', 'jsonType.label': 'String',
                'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true'}})
        realm = {'realm': 'agenttrust', 'enabled': True, 'registrationAllowed': False, 'resetPasswordAllowed': False,
            'rememberMe': False, 'loginWithEmailAllowed': False, 'sslRequired': 'all',
            'roles': {'realm': [{'name': role} for role in ('admin', 'editor', 'viewer')]},
            'clients': [{'clientId': 'agenttrust-console', 'enabled': True, 'protocol': 'openid-connect',
                'publicClient': False, 'secret': client_secret, 'standardFlowEnabled': True,
                'directAccessGrantsEnabled': False, 'serviceAccountsEnabled': False,
                'redirectUris': ['https://console.example.com/backend/login/oauth2/code/keycloak'],
                'webOrigins': ['https://console.example.com'], 'protocolMappers': mappers,
                'attributes': {'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': 'https://console.example.com/'}}],
            'users': [{'id': a['actorId'], 'username': a['username'], 'enabled': True,
                'firstName': 'Synthetic', 'lastName': 'Reviewer', 'emailVerified': True,
                'email': a['username'] + '@agenttrust.invalid', 'requiredActions': [], 'realmRoles': [a['role']],
                'attributes': {'agenttrust_organization': [a['organizationId']], 'agenttrust_project': [a['projectId']]},
                'credentials': [{'type': 'password', 'value': a['password'], 'temporary': False}]} for a in accounts]}
        target, external_realm, manifest = enterprise_configuration(realm, accounts)
        # Keep built-in primary browser flows: install only the custom broker
        # flow/provider/links through bounded own-realm admin REST after startup.
        realm_file = private_file('agenttrust-realm.json', json.dumps(realm), True)
        enterprise_realm_file = private_file('enterprise-synthetic-realm.json', json.dumps(external_realm), True)
        enterprise_config_file = private_file('enterprise-configuration.json',
            json.dumps({'primary': target, 'external': external_realm, 'manifest': manifest}), True)
        db_env = envfile('database.env', {'POSTGRES_DB': 'agenttrust_stack', 'POSTGRES_USER': 'agenttrust_stack', 'POSTGRES_PASSWORD': owner_password})
        jdbc = 'jdbc:postgresql://stack-db:5432/agenttrust_stack?connectTimeout=2&socketTimeout=5&tcpKeepAlive=true'
        migrate_env = envfile('migration.env', {'STACK_DATABASE_URL': jdbc, 'STACK_MIGRATION_USER': 'agenttrust_stack', 'STACK_MIGRATION_PASSWORD': owner_password, 'REDGATE_DISABLE_TELEMETRY': 'true'})
        core_env = envfile('core.env', {'STACK_DATABASE_URL': jdbc, 'STACK_DATABASE_USER': 'agenttrust_stack_api',
            'STACK_DATABASE_PASSWORD': api_password, 'STACK_DEMO_CREDENTIALS_FILE': '/run/secrets/stack-demo-credentials', 'STACK_IDENTITY_MODE': 'keycloak',
            'AGENTTRUST_OIDC_PROFILE': 'https-review', 'AGENTTRUST_OIDC_APPLICATION_ORIGIN': 'https://console.example.com',
            'AGENTTRUST_OIDC_PUBLIC_ISSUER': 'https://identity.example.com/realms/agenttrust',
            'SERVER_SERVLET_SESSION_COOKIE_SECURE': 'true', 'SERVER_SERVLET_SESSION_COOKIE_SAME_SITE': 'lax'})
        identity_env = envfile('identity.env', {'KC_DB_URL': 'jdbc:postgresql://stack-db:5432/agenttrust_stack_identity',
            'KC_DB_USERNAME': 'agenttrust_stack_identity', 'KC_DB_PASSWORD': identity_password, 'KC_LOG_LEVEL': 'warn',
            'KC_BOOTSTRAP_ADMIN_USERNAME': 'fixture-admin', 'KC_BOOTSTRAP_ADMIN_PASSWORD': administrator_password,
            'KC_TRUSTSTORE_PATHS': '/fixture/ca.crt', 'KC_TLS_HOSTNAME_VERIFIER': 'DEFAULT'})
        enterprise_env = envfile('enterprise.env', {'KC_DB_URL': 'jdbc:postgresql://stack-db:5432/agenttrust_stack_enterprise',
            'KC_DB_USERNAME': 'agenttrust_stack_enterprise', 'KC_DB_PASSWORD': enterprise_password, 'KC_LOG_LEVEL': 'warn',
            'KC_BOOTSTRAP_ADMIN_USERNAME': 'fixture-admin', 'KC_BOOTSTRAP_ADMIN_PASSWORD': enterprise_administrator_password,
            'KC_TRUSTSTORE_PATHS': '/fixture/ca.crt', 'KC_TLS_HOSTNAME_VERIFIER': 'DEFAULT'})
        extra_tokens = [(private_file(name, secrets.token_hex(32), True), '/run/secrets/stack-' + name)
                        for name in ('worker-token', 'nats-token', 'opa-token')]
        report['phase'] = 'create-owned-internal-network'
        ok(['docker', 'network', 'create', '--internal', '--label', 'agenttrust.fixture=' + identifier, prefix])
        network_created = True
        report['phase'] = 'generate-fresh-fixture-certificates'
        script_bind = bind(ROOT / 'scripts', '/scripts')
        # Only generator containers receive a writable mount of their own empty directory.
        start('certificates', images['tools'], [*script_bind, '--user', str(os.getuid()) + ':' + str(os.getgid()),
            '--mount', 'type=bind,source=' + str(certificate_dir) + ',target=/out'],
            ['python', '-c', 'import sys;sys.path.insert(0,"/scripts");from stack_https_fixture_certificates import generate;generate("/out")'], False, '256m')
        for name in ('ca.crt', 'server.crt', 'server.key'):
            path = certificate_dir / name
            require(path.is_file() and not path.is_symlink())
            path.chmod(0o444)
            owned_files.append(path)
        start('truststore', images['core'], [*bind(certificate_dir / 'ca.crt', '/ca.crt'), '--user', str(os.getuid()) + ':' + str(os.getgid()),
            '--entrypoint', 'keytool', '--mount', 'type=bind,source=' + str(trust_dir) + ',target=/out'],
            ['-importcert', '-noprompt', '-alias', 'ephemeral-fixture-ca', '-file', '/ca.crt',
             '-keystore', '/out/fixture.jks', '-storepass', 'fixture-public-ca'], False, '256m')
        truststore = trust_dir / 'fixture.jks'
        truststore.chmod(0o444)
        owned_files.append(truststore)
        report['phase'] = 'start-fresh-postgres'
        start('db', images['database'], ['--network-alias', 'stack-db', '--env-file', str(db_env),
            '--tmpfs', '/var/run/postgresql:size=16m,uid=70,gid=70,mode=3775',
            '--tmpfs', '/var/lib/postgresql/data:size=320m,uid=70,gid=70,mode=0700'])
        until = time.monotonic() + 90
        while run(['docker', 'exec', prefix + '-db', 'pg_isready', '-h', '127.0.0.1', '-U', 'agenttrust_stack', '-d', 'agenttrust_stack']).returncode:
            require(time.monotonic() < until)
            time.sleep(1)
        sql("CREATE ROLE agenttrust_stack_api LOGIN PASSWORD '" + api_password + "'; GRANT CONNECT ON DATABASE agenttrust_stack TO agenttrust_stack_api; CREATE ROLE agenttrust_stack_identity LOGIN PASSWORD '" + identity_password + "'; CREATE DATABASE agenttrust_stack_identity OWNER agenttrust_stack_identity;")
        sql("CREATE ROLE agenttrust_stack_enterprise LOGIN PASSWORD '" + enterprise_password + "'; CREATE DATABASE agenttrust_stack_enterprise OWNER agenttrust_stack_enterprise;")
        report['phase'] = 'actual-compiled-migration-process'
        migrated = json.loads(start('migrate', images['core'], ['--env-file', str(migrate_env)], ['--migrate-only'], False))
        require(migrated['completed'] and migrated['apiServerStarted'] is False)
        report['migrationsExecuted'] = migrated['migrationsExecuted']
        require(migrated['migrationsExecuted'] == len(list((ROOT / 'services/core-api/src/main/resources/db/migration').glob('*.sql'))))
        for index in range(2):
            actor = next(a for a in accounts if a['organizationId'] == organizations[index] and a['role'] == 'admin')
            sql("INSERT INTO public.stack_runs(id,organization_id,project_id,actor_id,idempotency_key,request_hash,scenario,requires_approval,state,decision,result,provider) VALUES ('" + witnesses[index] + "','" + organizations[index] + "','" + projects[index] + "','" + actor['actorId'] + "','synthetic-tls-scope-witness-" + str(index) + "','" + '0' * 64 + "','pass',true,'succeeded','pass','{}'::jsonb,'synthetic');")
        def witness_hash():
            return sql("BEGIN READ ONLY;SELECT count(*)::text||'|'||encode(sha256(convert_to(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'UTF8')),'hex') FROM public.stack_runs t WHERE id IN ('" + "','".join(witnesses) + "');ROLLBACK;").decode().splitlines()[-2]
        witness_before = witness_hash()
        report['phase'] = 'start-actual-keycloak'
        start('identity', images['identity'], ['--network-alias', 'tls-identity', '--env-file', str(identity_env),
            *bind(realm_file, '/opt/keycloak/data/import/agenttrust-realm.json'),
            *bind(certificate_dir / 'ca.crt', '/fixture/ca.crt'),
            '--tmpfs', '/opt/keycloak/data:size=64m,uid=1000,gid=1000,mode=0700'],
            ['start', '--optimized', '--http-enabled=true', '--hostname=https://identity.example.com',
             '--proxy-headers=xforwarded', '--import-realm'], memory='768m')
        start('enterprise', images['identity'], ['--network-alias', 'tls-enterprise', '--env-file', str(enterprise_env),
            *bind(enterprise_realm_file, '/opt/keycloak/data/import/enterprise-synthetic-realm.json'),
            *bind(certificate_dir / 'ca.crt', '/fixture/ca.crt'),
            '--tmpfs', '/opt/keycloak/data:size=64m,uid=1000,gid=1000,mode=0700'],
            ['start', '--optimized', '--http-enabled=true', '--hostname=https://enterprise.example.net',
             '--proxy-headers=xforwarded', '--import-realm'], memory='768m')
        report['phase'] = 'start-actual-https-profile-core-and-console'
        mounts = [*bind(account_file, '/run/secrets/stack-demo-credentials'), *bind(secret_file, '/run/secrets/stack-oidc-client-secret'), *bind(truststore, '/fixture.jks')]
        for path, target in extra_tokens:
            mounts.extend(bind(path, target))
        start('core', images['core'], ['--network-alias', 'stack-core-api', '--env-file', str(core_env), '--entrypoint', 'java', *mounts],
            ['-Djavax.net.ssl.trustStore=/fixture.jks', '-Djavax.net.ssl.trustStorePassword=fixture-public-ca',
             '-XX:MaxRAMPercentage=65', '-jar', '/app/core-api.jar'], memory='768m')
        start('console', images['console'], ['--network-alias', 'tls-console', '-e', 'CORE_API_URL=http://stack-core-api:8080'], memory='384m')
        require(ok(['docker', 'exec', prefix + '-console', 'node', '--version']).decode().strip().startswith('v24.'))
        report['httpsConsoleActualNode24Verified'] = True
        report['phase'] = 'start-fixed-tls-edge'
        start('edge', images['edge'], ['--network-alias', 'tls-edge', '--network-alias', 'console.example.com',
            '--network-alias', 'identity.example.com', '--network-alias', 'enterprise.example.net',
            '--user', '1000:1000', '--sysctl', 'net.ipv4.ip_unprivileged_port_start=0',
            *bind(ROOT / 'scripts/stack_https_fixture_edge.mjs', '/edge.mjs'),
            *bind(ROOT / 'scripts/stack_https_fixture_edge_policy.mjs', '/edge-policy.mjs'),
            *bind(certificate_dir / 'server.key', '/fixture/certificates/server.key'),
            *bind(certificate_dir / 'server.crt', '/fixture/certificates/server.crt')], ['node', '/edge.mjs'], memory='128m')
        report['phase'] = 'wait-for-real-fixture-readiness'
        until = time.monotonic() + 180
        while True:
            core_ready = run(['docker', 'exec', prefix + '-core', 'java', '-cp', '/app/health', 'HealthProbe']).returncode == 0
            identity_ready = run(['docker', 'exec', prefix + '-identity', 'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/9000; printf "GET /health/ready HTTP/1.0\r\n\r\n" >&3; read -r status <&3; case "$status" in *200*) exit 0;; *) exit 1;; esac']).returncode == 0
            enterprise_ready = run(['docker', 'exec', prefix + '-enterprise', 'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/9000; printf "GET /health/ready HTTP/1.0\r\n\r\n" >&3; read -r status <&3; case "$status" in *200*) exit 0;; *) exit 1;; esac']).returncode == 0
            report['lastFixtureReadiness'] = {'core': core_ready, 'identity': identity_ready, 'enterprise': enterprise_ready}
            if core_ready and identity_ready and enterprise_ready:
                break
            require(time.monotonic() < until)
            time.sleep(2)
        report['phase'] = 'verify-fresh-provider-scope-storage'
        primary_attributes_before = identity_attributes('agenttrust_stack_identity', 'agenttrust', realm['users'])
        external_attributes_before = identity_attributes('agenttrust_stack_enterprise', 'enterprise-synthetic', external_realm['users'])
        report['phase'] = 'actual-tls-oidc-pkce-cookie-scope-and-logout'
        result = json.loads(start('probe', images['tools'], [*script_bind, *bind(account_file, '/fixture/accounts.json'),
            *bind(administrator_file, '/fixture/administrator.json'),
            *bind(enterprise_config_file, '/fixture/enterprise-configuration.json'),
            *bind(certificate_dir / 'ca.crt', '/fixture/certificates/ca.crt')],
            ['python', '/scripts/stack_https_fixture_probe.py'], False, '256m', 300))
        require(result['completed'] and result['actualTlsProtocolLoginVerified'] and result['actualKeycloakTokenJwkUserinfoRequestsObserved'])
        if args.with_browser:
            report['phase'] = 'actual-chromium-tls-browser'
            network = json.loads(ok(['docker', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', prefix + '-edge']))
            require(set(network) == {prefix})
            private_file('browser.json', json.dumps({'edgeAddress': network[prefix]['IPAddress'],
                'accounts': accounts, 'enterpriseManifest': manifest}))
            state_file = private_file('browser-state-expected.json', json.dumps({
                'nativeAdminStateSha256': result['syntheticEnterpriseBrokerControls']['nativeAdminStateSha256']}), True)
            browser_environment = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'LC_ALL',
                'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH', 'GITHUB_ACTIONS', 'CI', 'GITHUB_WORKSPACE', 'TZ') if key in os.environ}
            browser = run(['node', str(ROOT / 'scripts/stack_https_fixture_browser.mjs'), str(directory)],
                timeout=600, environment=browser_environment)
            browser_result = public_browser_result(browser.stdout)
            if browser.returncode or not browser_result['completed']:
                require(browser_result['completed'] is False)
                report['browserFailure'] = browser_result
                raise RuntimeError('SYNTHETIC_HTTPS_BROWSER_UNVERIFIED')
            report['browserEvidence'] = browser_result
        if args.with_enterprise_pilot:
            report['phase'] = 'start-owned-evaluation-and-policy-processes'
            tokens = {target.rsplit('/', 1)[1]: path for path, target in extra_tokens}
            nats_value = tokens['stack-nats-token'].read_text()
            opa_value = tokens['stack-opa-token'].read_text()
            nats_config = private_file('pilot-nats.conf', 'port: 4222\nhttp: 8222\nmax_payload: 4096\n'
                'authorization { token: "' + nats_value + '" }\n'
                'jetstream { store_dir: "/tmp/jetstream", max_memory_store: 16MB, max_file_store: 32MB }\n', True)
            opa_auth = private_file('pilot-opa-auth.json', json.dumps({'stack_auth': {'token': opa_value}}), True)
            start('nats', images['messaging'], ['--network-alias', 'stack-nats',
                *bind(nats_config, '/run/secrets/stack-nats-config')], ['-c', '/run/secrets/stack-nats-config'], memory='128m')
            start('opa', images['policy'], ['--network-alias', 'stack-opa',
                *bind(opa_auth, '/run/secrets/stack-opa-auth.json')], memory='128m')
            until = time.monotonic() + 45
            while run(['docker', 'exec', prefix + '-nats', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8222/healthz']).returncode:
                require(time.monotonic() < until); time.sleep(1)
            start('worker', images['worker'], ['--network-alias', 'stack-ai-worker',
                *bind(tokens['stack-worker-token'], '/run/secrets/stack-worker-token'),
                *bind(tokens['stack-nats-token'], '/run/secrets/stack-nats-token')], memory='256m')
            until = time.monotonic() + 60
            while run(['docker', 'exec', prefix + '-worker', 'python', '-c',
                    'import urllib.request;urllib.request.urlopen("http://127.0.0.1:8000/ready",timeout=2)']).returncode:
                require(time.monotonic() < until); time.sleep(1)
            report['phase'] = 'actual-federated-evaluation-approval-and-revocation'
            pilot = json.loads(start('pilot', images['tools'], [*script_bind,
                *bind(account_file, '/fixture/accounts.json'),
                *bind(enterprise_config_file, '/fixture/enterprise-configuration.json'),
                *bind(certificate_dir / 'ca.crt', '/fixture/certificates/ca.crt')],
                ['python', '/scripts/stack_https_fixture_pilot.py'], False, '256m', 300))
            validate_pilot_result(pilot)
            report.update(enterprisePilotEvidence=pilot, actualFederatedEvaluationPilotVerified=True)
            require(sql('BEGIN READ ONLY;SELECT count(*) FROM public.stack_runs;ROLLBACK;').decode().splitlines()[-2] == '6')
        if args.with_browser:
            report['phase'] = 'verify-post-browser-provider-state'
            browser_state = json.loads(start('browser-state', images['tools'], [*script_bind,
                *bind(account_file, '/fixture/accounts.json'), *bind(administrator_file, '/fixture/administrator.json'),
                *bind(enterprise_config_file, '/fixture/enterprise-configuration.json'),
                *bind(state_file, '/fixture/browser-state-expected.json')],
                ['python', '/scripts/stack_https_fixture_broker_state.py'], False, '256m', 90))
            require(browser_state['completed'] and browser_state['allPrimaryAndExternalProviderSessionsClosed']
                and browser_state['nativeAdminVisibleProfilesRolesAndLinksMatchBeforeBrowser'])
            report['browserPostState'] = browser_state
        require(witness_before == witness_hash() and witness_before.startswith('2|'))
        require(identity_attributes('agenttrust_stack_identity', 'agenttrust', realm['users']) == primary_attributes_before
            and identity_attributes('agenttrust_stack_enterprise', 'enterprise-synthetic', external_realm['users']) == external_attributes_before)
        report.update(completed=True, phase='completed', actualTlsLoginVerified=True,
            protocolEvidence=result, seededWitnessRowsUnchanged=True, seededWitnessesNotActualEvaluations=True,
            tlsTrustAndHostnameVerificationEnabled=True, applicationOrHostTrustStoresModified=False,
            syntheticEnterpriseBrokerVerified=result['actualSyntheticEnterpriseBrokerVerified'],
            enterpriseProviderIsSeparateSyntheticProcess=True,
            freshPrimaryAndExternalUserAttributesExactlyPreserved=True,
            providerUserAttributeChecksAreReadOnlyAndFixtureOnly=True,
            chromiumRenderingVerified=args.with_browser,
            actualSyntheticEnterpriseBrowserVerified=bool(args.with_browser and report['browserEvidence']['enterpriseBrowserVerified']))
    except Exception as error:
        report.update(completed=False, errorType=type(error).__name__, code='SYNTHETIC_HTTPS_FIXTURE_UNVERIFIED')
    finally:
        cleaned = True
        for name in reversed(containers):
            try:
                if run(['docker', 'inspect', name]).returncode == 0:
                    own(name, cleanup=True)
                    ok(['docker', 'rm', '-f', name])
            except Exception:
                cleaned = False
        if network_created:
            try:
                require(ok(['docker', 'network', 'inspect', '--format', '{{index .Labels "agenttrust.fixture"}}', prefix]).decode().strip() == identifier)
                ok(['docker', 'network', 'rm', prefix])
            except Exception:
                cleaned = False
        if cleaned:
            # These exact fresh children belong only to this UUID execution.
            # Keep all browser profiles/cache/NSS state inside the owned tree.
            for name in ('browser-untrusted', 'browser-trusted', 'browser-owned-tmp'):
                path = directory / name
                try:
                    if path.exists():
                        require(not path.is_symlink() and path.resolve().parent == directory.resolve()
                            and path.resolve().is_relative_to(ROOT / '.local'))
                        shutil.rmtree(path)
                except Exception:
                    cleaned = False
            for path in owned_files:
                try:
                    require(path.resolve().is_relative_to(directory.resolve()) and not path.is_symlink())
                    path.chmod(0o600)
                    path.unlink()
                except Exception:
                    cleaned = False
        report['ownedContainersNetworkAndPrivateFilesRemoved'] = cleaned
        try:
            report['sourceRuntimeUnchanged'] = before is not None and runtime() == before
            report['sourceBusinessTablesUnchanged'] = before_business is not None and fingerprint() == before_business
        except Exception:
            report['sourceRuntimeUnchanged'] = report['sourceBusinessTablesUnchanged'] = False
        report['cDriveFreeBytes'] = shutil.disk_usage(ROOT).free
        if not cleaned or not report['sourceRuntimeUnchanged'] or not report['sourceBusinessTablesUnchanged'] or report['cDriveFreeBytes'] < 22 * 1024 ** 3:
            report['completed'] = False
        report['finishedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        path = directory / 'summary.json'
        path.open('x', encoding='utf-8').write(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'completed': report['completed'], 'phase': report['phase'], 'reportPath': str(path),
            'actualTlsLoginVerified': report['actualTlsLoginVerified'], 'privateInputsPrinted': False,
            'ownedResourcesRemoved': cleaned}))
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'completed': False, 'executed': False, 'code': 'SYNTHETIC_HTTPS_PREFLIGHT_REFUSED',
                          'errorType': type(error).__name__, 'privateInputsPrinted': False}))
        raise SystemExit(1)
