# 01. Domain Development Kit (DDK)

## Purpose
The Domain Development Kit (DDK) is the standard toolkit for scaffolding, defining, and building new business domains on top of ThePlugOS, without modifying the underlying Platform Core or SDK.

## Capabilities
- **Scaffolding:** Automatically generate boilerplate for a new domain (`plugos create domain <name>`).
- **Domain Manifest:** A declarative JSON/YAML manifest defining the domain's entities, required capabilities, and metadata.
- **Entity Definitions:** Scaffolds schemas for CQRS state projections.
- **Event Definitions:** Scaffolds event contracts and validation logic.
- **Workflows & Rules:** Scaffolds state machines and business rule evaluation blocks.
- **UI Registration:** Connects domain state to UI components via `@plugos/react`.
- **Localization & Seed Data:** Provisions initial configuration and translation bundles.

## Principles
- **Zero Core Modification:** A domain must exist purely as configuration, events, state reducers, and UI components.
- **Declarative over Imperative:** Domain capabilities (rules, workflows) should be defined declaratively in the manifest wherever possible.
