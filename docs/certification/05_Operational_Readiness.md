# 05. Operational Readiness

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

## Installation & Provisioning
- Tablets and devices can be provisioned using a standard MDM (Mobile Device Management) pushing the compiled PWA/App bundle.
- Initial branch bootstrapping pulls the domain manifest and historical snapshots.

## Diagnostics
- The `HealthEngine` continuously monitors internal adapters.
- Diagnostics can be exported locally via the CLI or shipped automatically when connectivity is restored via the `MetricsEngine`.

## Support Workflow
- Non-technical operators can hard-restart the application safely because state is purely derived from the persistent event log. No corrupted mid-transaction states.

## Status: PASS
