# kcadm-node

Use Node.js 22 or later for CLI work. The CLI depends on the official
`@keycloak/keycloak-admin-client` pinned to 26.8.2.
Use TypeScript and Node.js for project tooling, including the server matrix
runner at `test/integration/run.ts`. Do not add `.py` files or Python runtime
dependencies to the project.

## Documentation

Write README.md for people using or contributing to the CLI. Put coding-agent
instructions in AGENTS.md and agent workflows for operating the CLI in
`skills/keycloak-admin/SKILL.md`. Repeat facts where each audience needs them.

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
- For npm release candidates, use the pinned SDK version as the base and
  append `-rc.N`. Start at `1` for each SDK version and increment for later
  candidates. Keep the package manifest, lockfile, and README examples in sync.
- The current milestone is local validation. Publishing to npm requires
  an explicit release request.

## Repository workflow

[Commit Rules](docs/00-governance/COMMIT-RULES.md) define authorization,
scope and message format. [PR Rules](docs/00-governance/PR-RULES.md)
define branch, review and merge requirements.
