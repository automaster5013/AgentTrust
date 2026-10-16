import copy
import json
import pathlib
import sys
import unittest
import uuid
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from stack_https_fixture_enterprise import build, validate


def fresh():
    organizations, projects = [[str(uuid.uuid4()) for _ in range(2)] for _ in range(2)]
    accounts = [{'actorId': str(uuid.uuid4()), 'username': name, 'role': role,
        'organizationId': organizations[index], 'projectId': projects[index]} for name, role, index in
        [('demo-admin', 'admin', 0), ('demo-editor', 'editor', 0), ('demo-viewer', 'viewer', 0), ('other-admin', 'admin', 1)]]
    primary = {'realm': 'agenttrust', 'registrationAllowed': False, 'sslRequired': 'all',
        'clients': [{'protocolMappers': []}], 'users': [{'id': a['actorId'], 'username': a['username'],
            'realmRoles': [a['role']], 'email': a['username'] + '@agenttrust.invalid',
            'attributes': {'agenttrust_organization': [a['organizationId']], 'agenttrust_project': [a['projectId']]}}
            for a in accounts]}
    return primary, accounts


class EnterpriseFixtureContractTest(unittest.TestCase):
    def test_configuration_preserves_inputs_and_cannot_claim_runtime_acceptance(self):
        original, accounts = fresh()
        before = copy.deepcopy((original, accounts))
        primary, external, manifest = build(original, accounts)
        result = validate(primary, external, manifest)
        self.assertEqual((original, accounts), before)
        self.assertEqual(result['prelinkedNativeAccounts'], 4)
        self.assertFalse(result['actualBrokerFlowVerified'])
        self.assertFalse(result['productionEnterpriseIdpVerified'])

    def test_unsafe_broker_variants_are_rejected(self):
        original, accounts = fresh()
        primary, external, manifest = build(original, accounts)
        mutations = [
            lambda p, e: p['identityProviders'][0].update(trustEmail=True),
            lambda p, e: p['identityProviders'][0].update(firstBrokerLoginFlowAlias='first broker login'),
            lambda p, e: p['identityProviders'][0]['config'].update(validateSignature='false'),
            lambda p, e: p['identityProviders'][0]['config'].update(pkceMethod='plain'),
            lambda p, e: p['identityProviders'][0]['config'].update(tokenUrl='http://identity.example.com/token'),
            lambda p, e: p['identityProviders'][0]['config'].update(syncMode='FORCE'),
            lambda p, e: p['identityProviderMappers'].append({'identityProviderMapper': 'oidc-user-attribute-idp-mapper'}),
            lambda p, e: p['authenticationFlows'][0]['authenticationExecutions'][0].update(requirement='DISABLED'),
            lambda p, e: e['clients'][0].update(directAccessGrantsEnabled=True),
            lambda p, e: e['clients'][0].update(redirectUris=['https://evil.invalid/callback']),
            lambda p, e: p['users'][0]['federatedIdentities'][0].update(userId=manifest['unlinkedAccount']['actorId']),
        ]
        for mutate in mutations:
            p, e = copy.deepcopy(primary), copy.deepcopy(external)
            mutate(p, e)
            with self.subTest(kind='unsafe-federation-configuration'), self.assertRaises(ValueError):
                validate(p, e, manifest)

    def test_existing_federation_configuration_is_never_adopted(self):
        original, accounts = fresh()
        original['identityProviders'] = [{'alias': 'original-provider'}]
        with self.assertRaises(ValueError):
            build(original, accounts)
        original, accounts = fresh()
        original['users'][0]['federatedIdentities'] = [{'identityProvider': 'original-provider'}]
        with self.assertRaises(ValueError):
            build(original, accounts)


if __name__ == '__main__':
    unittest.main()
