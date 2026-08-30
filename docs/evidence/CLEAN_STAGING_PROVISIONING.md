# Clean staging provisioning record

- **Status:** provisioned; R001 clone not yet performed
- **Project:** `theplugos-r001-clean-staging`
- **Reference:** `nuufscrmkfoukndfmwcc`
- **Region:** EU West (`eu-west-1`)
- **Plan:** Free ($0/month)
- **Provisioned:** 21 August 2026

The project was created as the isolated replacement for the contaminated
legacy staging project. At creation, the public schema had no tables, the
project had no migration history, and it had no deployed Edge Functions.

Production `iwbbwcaylpulcpvbfkdx` was not modified. Legacy staging
`dpqtgfxovmiwzkiuzoya` was paused, preserving its data as non-release evidence
while releasing the Free-plan project slot.

The next permitted action is the exact R001 clone described in
`docs/operations/R001_FREE_PLAN_STAGING_CLONE_RUNBOOK.md`. R002, R003, Edge
Function deployment, and production mutation remain blocked pending the stated
gates.
