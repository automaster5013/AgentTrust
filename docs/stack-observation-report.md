# Verified historical campaign HTML report

The offline CLI verifies an existing Java-issued Ed25519 observation receipt, frozen versions, and the complete parent/child archive byte chain before writing a new HTML file. Supply the development public key through a separately trusted channel and the expected organization, project, and campaign IDs. A key embedded in an untrusted bundle is not a trust anchor.

```sh
node --experimental-strip-types scripts/stack-observation-report.ts \
  --bundle bundle.json --trusted-public-key public-key.pem \
  --organization ORGANIZATION_UUID --project PROJECT_UUID \
  --campaign CAMPAIGN_UUID --output report.html
```

Node.js 24 is used in CI. The output directory must already exist, and an existing output file is never overwritten. Input limits are 512 KiB for the bundle and 4 KiB for the key; output is limited to 64 KiB. Invalid UTF-8, altered archive bytes, invalid signatures, or a different scope fail before output creation.

The Korean report includes case outcomes, frozen version hashes, archive hashes, and the OPA decision recorded when the receipt was issued. It excludes prompts, expected answers, model outputs, user notes, and credentials. It contains no JavaScript or external assets and applies a restrictive content security policy. Scope IDs and case IDs remain visible: review the report before sharing it.

This is historical evidence under a local development key. The HTML itself is unsigned, conveys no current deployment authority, and does not execute deployment. Independent review requires the original bundle and separately trusted public key. Current approval must be checked through the authenticated current-gate endpoint.

Validation combines three negative/positive CLI tests with `stack-observation-report-smoke.py`, which reads an existing successful Java receipt fixture and performs no business writes or network requests. CI repeats this against both built services and the exact registry images and retains the small report with the other review evidence for seven days.
