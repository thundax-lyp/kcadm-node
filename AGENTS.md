# kcadm-node

This repository contains the TypeScript CLI and the agent-facing Skill in
`skills/keycloak-admin/SKILL.md`. The CLI runs on Node.js 22 or later and
uses the official `@keycloak/keycloak-admin-client` pinned to 26.8.2.

## CLI behavior

Use upstream `kcadm` as the reference for the behavior of implemented
commands, including argument defaults, merge behavior, output and exit
status. Document the supported subset in the README. Keep generic Admin
REST paths available through the authenticated transport and use SDK
resource methods for role mappings.

Keep credentials and tokens out of repository files and test artifacts.
Use the target realm explicitly for writes. When a write has an unknown
outcome, verify remote state before retrying.

## Local checks

- Run `npm ci` and `npm test` for CLI changes.
- Run `npm run test:matrix` for changes to authentication, API calls or
  compatibility behavior. The README describes the local distributions
  and Java paths. The matrix samples Keycloak 23.0.0, 24.0.0, 25.0.0,
  and 26.0.0. Record the exact versions tested.
- Update the Skill examples when its CLI usage changes. Verify the
  package contents locally with `npm pack --dry-run`.
- The current milestone is local validation. Publishing to npm requires
  an explicit release request.

## Repository workflow

[Commit Rules](docs/00-governance/COMMIT-RULES.md) define authorization,
scope and message format. [PR Rules](docs/00-governance/PR-RULES.md)
define branch, review and merge requirements.
