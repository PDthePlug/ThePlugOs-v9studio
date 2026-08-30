# 03. Domain Simulator

## Purpose
An isolated execution environment for testing domains without a full UI or production infrastructure.

## Capabilities
- **Event Replay:** Inject a sequence of events and assert the final projected state.
- **Workflow Execution:** Step through state machines programmatically.
- **Rule Evaluation:** Test business rules against mocked context.
- **Failure Injection:** Simulate network partitions, storage failures, or sync conflicts.
- **Offline Sync Simulation:** Test CQRS eventual consistency.

## Usage
The simulator runs via the CLI (`plugos simulate`) and integrates seamlessly with the Testing SDK.
