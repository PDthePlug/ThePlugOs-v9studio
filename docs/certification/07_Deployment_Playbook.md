# 07. Deployment Playbook

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

## Pre-Deployment
1. Validate domain manifest via `npx plugos certify <domain>`.
2. Run standard integration tests using `@plugos/testing`.
3. Bundle the PWA/React client with the target domain injected.

## Physical Deployment
1. Provision hardware with MDM.
2. Install ThePlugOS client.
3. Authenticate with Manager credentials.
4. Allow initial Sync (pulling domain rules and state snapshots).
5. Disconnect network to verify offline capability.
6. Handover to staff.

## Post-Deployment
- Monitor initial health metrics upon next network sync.
