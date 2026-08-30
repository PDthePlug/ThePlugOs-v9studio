# 04. Platform CLI

## Purpose
The `@plugos/cli` is the single operational entry point for domain developers, managing the entire lifecycle of a domain package.

## Commands
- `plugos create domain <name>`: Scaffolds a new domain.
- `plugos validate`: Runs local static analysis against the domain manifest.
- `plugos test`: Executes the testing SDK suite against the domain.
- `plugos certify`: Runs the comprehensive Domain Certification Framework.
- `plugos simulate`: Opens the Domain Simulator.
- `plugos package`: Bundles the domain into a distributable package.
- `plugos install <package>`: Installs a domain package into a local runtime.
