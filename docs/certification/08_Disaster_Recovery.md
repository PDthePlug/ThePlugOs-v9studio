# 08. Disaster Recovery

> **Release status: superseded / not evidence.** This historical artifact contains prototype or simulated claims and cannot authorize release. See [the current release status](../operations/RELEASE_STATUS.md).

## Scenarios
1. **Power Failure during Transaction:**
   - *Impact:* Minimal. The event log is append-only and flushed to local IndexedDB/SQLite synchronously. Restarting the app rebuilds the state perfectly.
2. **Device Destruction (Theft/Damage):**
   - *Impact:* Loss of un-synced events (the delta since the last network connection).
   - *Recovery:* Provision a new device, login, and the cloud sync pulls the last known state.
3. **Database Corruption:**
   - *Impact:* Local state corruption.
   - *Recovery:* Clear local IndexedDB. The OS will re-sync the event log from the cloud and rebuild local state from scratch.

## Status: PASS
