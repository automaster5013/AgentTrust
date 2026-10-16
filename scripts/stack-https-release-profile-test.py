"""Fake public metadata controls; these tests cannot certify image signatures."""
import copy
import hashlib
import json
import unittest
from stack_https_fixture_diagnostics import BROWSER_SUCCESS
from stack_https_release_profile import from_fixture, validate
from stack_https_fixture_pilot import TRUE_FLAGS, FALSE_FLAGS

REVISION = '1' * 40
REFERENCES = {name: 'ghcr.io/automaster5013/agenttrust-' + name + '@sha256:' + '2' * 64
    for name in ('core-api', 'database', 'identity', 'console-https', 'ai-worker', 'messaging', 'opa')}
IMAGE_IDS = {name: 'sha256:' + '3' * 64 for name in REFERENCES}


def fixture():
    value = {key: True for key in ('completed', 'browserRequested', 'actualTlsLoginVerified',
        'chromiumRenderingVerified', 'actualSyntheticEnterpriseBrowserVerified', 'syntheticEnterpriseBrokerVerified',
        'enterpriseProviderIsSeparateSyntheticProcess', 'seededWitnessesNotActualEvaluations',
        'enterprisePilotRequested', 'actualFederatedEvaluationPilotVerified',
        'httpsConsoleSourceRevisionLabelVerified', 'httpsConsoleRegistryImageIdentityVerified',
        'httpsConsoleActualNode24Verified', 'freshPrimaryAndExternalUserAttributesExactlyPreserved',
        'providerUserAttributeChecksAreReadOnlyAndFixtureOnly', 'sourceRuntimeUnchanged', 'sourceBusinessTablesUnchanged',
        'ownedContainersNetworkAndPrivateFilesRemoved', 'seededWitnessRowsUnchanged', 'tlsTrustAndHostnameVerificationEnabled')}
    value.update({key: False for key in ('hostPortsPublished', 'originalVolumesMounted', 'originalCredentialsRead',
        'productionDeploymentPerformed', 'paidProviderCallsPerformed', 'privateInputsPrinted', 'applicationOrHostTrustStoresModified',
        'sourceServicesModified', 'httpsConsoleImageSignatureVerified', 'externalEnterpriseIdpVerified')})
    value.update(sourceRevision=REVISION, httpsConsoleRegistryReference=REFERENCES['console-https'],
        migrationsExecuted=17, cDriveFreeBytes=32 * 1024 ** 3,
        imageIds={'core': IMAGE_IDS['core-api'], 'database': IMAGE_IDS['database'],
                  'identity': IMAGE_IDS['identity'], 'console': IMAGE_IDS['console-https'],
                  'worker': IMAGE_IDS['ai-worker'], 'messaging': IMAGE_IDS['messaging'], 'policy': IMAGE_IDS['opa']},
        enterprisePilotEvidence={**{k:True for k in TRUE_FLAGS}, **{k:False for k in FALSE_FLAGS},
            'actualFederatedLogins':4, 'actualPythonEvaluations':4},
        browserEvidence=dict(BROWSER_SUCCESS), browserPostState={'completed': True,
            'allPrimaryAndExternalProviderSessionsClosed': True,
            'nativeAdminVisibleProfilesRolesAndLinksMatchBeforeBrowser': True,
            'rawIdentityRowsExported': False, 'originalRealmContacted': False},
        protocolEvidence={'completed': True, 'actualSyntheticEnterpriseBrokerVerified': True,
            'syntheticEnterpriseBrokerControls': {'linkedActualLogins': 4,
                'unlinkedExternalLoginWithCollidingNativeEmailRefused': True,
                'linkedExternalSessionsClosedByActualBrokerLogoutBeforeFallback': True},
            'syntheticEnterpriseInstallation': {'defaultUserProfilePolicyUnchanged': True},
            'adverseIdentityClaimControls': {'actualSignedNilOrganizationAndProjectRefused': True,
                'actualConflictingUserInfoOrganizationRefused': True}})
    return value


def project(value):
    return from_fixture(json.dumps(value).encode(), REVISION, REFERENCES, IMAGE_IDS)


class HttpsProfileContract(unittest.TestCase):
    def test_projection_is_bounded_and_never_exports_unknown_summary_values(self):
        source = fixture(); source['rawException'] = 'PUBLIC-CANARY-MUST-NOT-BE-EXPORTED'
        record = project(source)
        self.assertEqual(validate(record, REVISION, REFERENCES, IMAGE_IDS), record)
        self.assertNotIn('PUBLIC-CANARY', json.dumps(record))
        self.assertFalse(record['privateInputsIncluded'])
        self.assertFalse(record['productionDeploymentPerformed'])

    def test_registry_identity_tls_logout_state_and_preservation_cannot_be_substituted(self):
        mutations = [lambda v: v.update(sourceRevision='4' * 40),
            lambda v: v.update(httpsConsoleRegistryReference=REFERENCES['core-api']),
            lambda v: v.update(httpsConsoleRegistryImageIdentityVerified=False),
            lambda v: v.update(httpsConsoleActualNode24Verified=False),
            lambda v: v['imageIds'].update(console='sha256:' + '5' * 64),
            lambda v: v['imageIds'].update(core='sha256:' + '5' * 64),
            lambda v: v['browserEvidence'].update(certificateVerificationDisabled=True),
            lambda v: v['browserPostState'].update(allPrimaryAndExternalProviderSessionsClosed=False),
            lambda v: v.update(freshPrimaryAndExternalUserAttributesExactlyPreserved=False),
            lambda v: v.update(productionDeploymentPerformed=True),
            lambda v: v.update(cDriveFreeBytes=1024),
            lambda v: v.update(enterpriseProviderIsSeparateSyntheticProcess=False),
            lambda v: v.update(actualFederatedEvaluationPilotVerified=False),
            lambda v: v['enterprisePilotEvidence'].update(actualPythonEvaluations=True),
            lambda v: v['enterprisePilotEvidence'].update(nonpassApprovalRefused=False),
            lambda v: v['imageIds'].update(worker='sha256:' + '5' * 64)]
        for mutate in mutations:
            value = fixture(); mutate(value)
            with self.subTest(kind='substituted-profile-evidence'), self.assertRaises(ValueError):
                project(value)

    def test_published_projection_rejects_extra_private_fields_and_forged_metadata(self):
        record = project(fixture())
        for key, value in [('password', 'PUBLIC-CANARY'), ('applicationOrigin', 'https://foreign.invalid'),
                           ('nativeBrowserLogins', True), ('actualSyntheticEnterpriseOnly', False),
                           ('privateInputsIncluded', True)]:
            bad = dict(record); bad[key] = value
            with self.subTest(kind='invalid-profile-record'), self.assertRaises(ValueError):
                validate(bad, REVISION, REFERENCES, IMAGE_IDS)


if __name__ == '__main__':
    unittest.main()
