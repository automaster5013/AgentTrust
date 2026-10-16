"""Strict public evidence for the separate, synthetic HTTPS Console image."""
import hashlib
import json
import re
from stack_https_fixture_diagnostics import public_browser_result

ORIGIN = 'https://console.example.com'
ISSUER = 'https://identity.example.com/realms/agenttrust'
EVIDENCE_FILE = 'https-profile-runtime.json'
TRUE_FIELDS = ('unlinkedAccountRefused', 'certificateVerificationEnabled',
    'untrustedCaWrongHostnameAndOutsideNavigationRefused', 'nativeIdentityAndAttributesPreserved',
    'allApplicationAndProviderSessionsClosed', 'sourceServicesAndBusinessPreserved',
    'ownedFixtureResourcesRemoved', 'actualSyntheticEnterpriseOnly')
FALSE_FIELDS = ('productionDeploymentPerformed', 'productionEnterpriseIdpVerified', 'privateInputsIncluded')


def require(value):
    if not value:
        raise ValueError('HTTPS_RELEASE_PROFILE_UNVERIFIED')


def image_id(value):
    require(isinstance(value, str) and re.fullmatch('sha256:[a-f0-9]{64}', value))
    return value


def validate(record, revision, references, image_ids):
    keys = {'schemaVersion', 'profile', 'applicationOrigin', 'publicIssuer', 'revision', 'reference',
        'imageId', 'fixtureSummarySha256', 'runtimeDependencies', 'nativeBrowserLogins', 'federatedBrowserLogins',
        *TRUE_FIELDS, *FALSE_FIELDS}
    require(isinstance(record, dict) and set(record) == keys)
    require(type(record['schemaVersion']) is int and record['schemaVersion'] == 1)
    require(record['revision'] == revision and isinstance(revision, str) and re.fullmatch('[a-f0-9]{40}', revision))
    require(record['profile'] == 'https-review' and record['applicationOrigin'] == ORIGIN and record['publicIssuer'] == ISSUER)
    require(record['reference'] == references['console-https']
        and re.fullmatch(r'ghcr\.io/automaster5013/agenttrust-console-https@sha256:[a-f0-9]{64}', record['reference']))
    require(image_id(record['imageId']) == image_id(image_ids['console-https']))
    require(isinstance(record['fixtureSummarySha256'], str) and re.fullmatch('[a-f0-9]{64}', record['fixtureSummarySha256']))
    require(isinstance(record['runtimeDependencies'], dict)
        and set(record['runtimeDependencies']) == {'core-api', 'database', 'identity'})
    require(all(image_id(record['runtimeDependencies'][name]) == image_id(image_ids[name])
        for name in ('core-api', 'database', 'identity')))
    require(all(type(record[key]) is int and record[key] == 4 for key in ('nativeBrowserLogins', 'federatedBrowserLogins')))
    require(all(record[key] is True for key in TRUE_FIELDS) and all(record[key] is False for key in FALSE_FIELDS))
    return record


def from_fixture(raw, revision, references, image_ids):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 65536)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique)
    require(value['sourceRevision'] == revision and value['httpsConsoleRegistryReference'] == references['console-https'])
    require(all(value[key] is True for key in ('completed', 'browserRequested', 'actualTlsLoginVerified',
        'chromiumRenderingVerified', 'actualSyntheticEnterpriseBrowserVerified', 'syntheticEnterpriseBrokerVerified',
        'enterpriseProviderIsSeparateSyntheticProcess', 'seededWitnessesNotActualEvaluations',
        'httpsConsoleSourceRevisionLabelVerified', 'httpsConsoleRegistryImageIdentityVerified',
        'httpsConsoleActualNode24Verified',
        'freshPrimaryAndExternalUserAttributesExactlyPreserved', 'providerUserAttributeChecksAreReadOnlyAndFixtureOnly',
        'sourceRuntimeUnchanged', 'sourceBusinessTablesUnchanged', 'ownedContainersNetworkAndPrivateFilesRemoved',
        'seededWitnessRowsUnchanged', 'tlsTrustAndHostnameVerificationEnabled')))
    require(all(value[key] is False for key in ('hostPortsPublished', 'originalVolumesMounted', 'originalCredentialsRead',
        'productionDeploymentPerformed', 'paidProviderCallsPerformed', 'privateInputsPrinted', 'applicationOrHostTrustStoresModified',
        'sourceServicesModified', 'httpsConsoleImageSignatureVerified', 'externalEnterpriseIdpVerified')))
    require(type(value['migrationsExecuted']) is int and value['migrationsExecuted'] == 17)
    require(type(value['cDriveFreeBytes']) is int and value['cDriveFreeBytes'] >= 22 * 1024 ** 3)
    require(public_browser_result(json.dumps(value['browserEvidence']).encode())['completed'] is True)
    state = value['browserPostState']
    require(state['completed'] is True and state['allPrimaryAndExternalProviderSessionsClosed'] is True
        and state['nativeAdminVisibleProfilesRolesAndLinksMatchBeforeBrowser'] is True
        and state['rawIdentityRowsExported'] is False and state['originalRealmContacted'] is False)
    protocol = value['protocolEvidence']; broker = protocol['syntheticEnterpriseBrokerControls']
    require(protocol['completed'] is True and protocol['actualSyntheticEnterpriseBrokerVerified'] is True
        and broker['linkedActualLogins'] == 4 and broker['unlinkedExternalLoginWithCollidingNativeEmailRefused'] is True
        and broker['linkedExternalSessionsClosedByActualBrokerLogoutBeforeFallback'] is True)
    require(protocol['syntheticEnterpriseInstallation']['defaultUserProfilePolicyUnchanged'] is True)
    require(protocol['adverseIdentityClaimControls']['actualSignedNilOrganizationAndProjectRefused'] is True
        and protocol['adverseIdentityClaimControls']['actualConflictingUserInfoOrganizationRefused'] is True)
    dependencies = {name: value['imageIds'][key] for name, key in (
        ('core-api', 'core'), ('database', 'database'), ('identity', 'identity'))}
    record = {'schemaVersion': 1, 'profile': 'https-review', 'applicationOrigin': ORIGIN, 'publicIssuer': ISSUER,
        'revision': revision, 'reference': references['console-https'], 'imageId': value['imageIds']['console'],
        'fixtureSummarySha256': hashlib.sha256(raw).hexdigest(), 'runtimeDependencies': dependencies,
        'nativeBrowserLogins': 4, 'federatedBrowserLogins': 4,
        **{key: True for key in TRUE_FIELDS}, **{key: False for key in FALSE_FIELDS}}
    return validate(record, revision, references, image_ids)
