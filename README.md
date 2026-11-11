# kcadm-node

A TypeScript CLI for Keycloak administration with kcadm-style commands. It uses the official `@keycloak/keycloak-admin-client` pinned to `26.8.2`. Resource commands use the SDK's authentication with a generic Admin REST transport. Role commands use the SDK's resource methods.

## Local development

Requires Node.js 22 or later.

```sh
npm ci
npm test
node dist/cli.js --help
```

Configure `KC_SERVER`, `KC_AUTH_REALM`, `KC_CLIENT_ID`, and `KC_CLIENT_SECRET` for service account authentication. Use `KC_USER` and `KC_CLI_PASSWORD` for password authentication on a client that allows it, or `KC_ACCESS_TOKEN` for an existing bearer token.

```sh
node dist/cli.js get users -r demo -q username=alice -q exact=true -F id,username
node dist/cli.js get-roles -r demo --uusername alice --cclientid example
```

`config credentials` validates the connection and stores the server, authentication realm, client ID, and optional username. Use `--config` or `KC_CONFIG` to pick a profile path. Each invocation obtains its own token using the supplied credentials or uses an explicitly supplied access token. Secrets and tokens stay out of the profile.

## Command coverage

The first version supports relative Admin REST paths with `get/create/update/delete`, pagination on `get`, top-level JSON field selection, JSON file and stdin input, dotted `-s` assignments, and user role mappings with `get-roles/add-roles/remove-roles`. For `update`, attribute assignments merge by default. A file replaces the payload by default, and `-m` requests a merge. Run `--help` for the available flags.

The official CLI's wider surface includes absolute endpoints, CSV and nested projection, Java truststore options, and group or composite role shortcuts. These remain outside the first version's compatibility scope.

For `get groups/ID/children`, supply `--server-version` or `KC_SERVER_VERSION` to normalize `briefRepresentation` on 23.0.0–23.0.3 and apply search locally on 23 and 24. Without a version the request retains the server's native behavior. The patch cutoff comes from upstream source. The matrix samples the initial release of each major.

User attribute handling depends on the Realm's User Profile. Verify a custom attribute by reading the user after writing it.

## Server compatibility tests

The matrix uses fresh local dev instances of Keycloak `23.0.0`, `24.0.0`, `25.0.0`, and `26.0.0`. Download and extract the corresponding [official distributions](https://github.com/keycloak/keycloak/releases) into a directory with one `keycloak-VERSION` subdirectory per release. Use Java 17 for 23/24 and Java 21 for 25/26, with Python 3 available.

```sh
KC_MATRIX_SERVERS=/path/to/distributions \
KC_MATRIX_JAVA17=/path/to/java-17 \
JAVA_HOME=/path/to/java-21 \
npm run test:matrix
```

The runner copies distributions to temporary directories, starts servers on loopback, and records the SDK and CLI results under `test/integration/results/`. Known raw SDK differences must reproduce while the CLI and workaround checks must pass. The matrix also compares selected Client query and update output against the official CLI bundled with each distribution.

The [keycloak-admin Skill](skills/keycloak-admin/SKILL.md) documents how an agent uses the local CLI.

See the [engineering docs](docs/README.md) for repository governance, requirements, design and verification.
