# 05. Testing SDK

## Purpose
The `@plugos/testing` package provides reusable testing utilities to streamline domain testing and ensure adherence to platform contracts.

## Components
- **Mock Adapters:** In-memory storage, mock sync layers, and mocked identity providers.
- **Contract Testers:** Automated generators that assert event structures conform to the manifest.
- **Workflow & Rule Assertions:** Specialized matchers (e.g., `expect(state).toHaveTransitionedTo('COMPLETED')`).
- **Offline Simulation:** Tools to disconnect the mock sync layer and assert offline queuing behavior.

## Integration
Intended to be used seamlessly with `vitest` or `jest` test suites within a domain repository.
