# kcadm-node

[简体中文](README.zh-CN.md)

A TypeScript CLI for Keycloak administration with kcadm-style commands.

## Getting started

Requires Node.js 22 or later.

Once `26.8.2-rc.1` is available on npm, install it globally or run it directly:

```sh
npm install --global kcadm-node@26.8.2-rc.1
kcadm-node --help
```

```sh
npx --yes kcadm-node@26.8.2-rc.1 --help
```

Configure `KC_SERVER`, `KC_AUTH_REALM`, `KC_CLIENT_ID`, and `KC_CLIENT_SECRET` for service account authentication. Use `KC_USER` and `KC_CLI_PASSWORD` for password authentication on a client that allows it, or `KC_ACCESS_TOKEN` for an existing bearer token.

```sh
kcadm-node get users -r demo -q username=alice -q exact=true -F id,username
kcadm-node get-roles -r demo --uusername alice --cclientid example
```

`config credentials` validates the connection and stores the server, authentication realm, client ID, and optional username. Use `--config` or `KC_CONFIG` to pick a profile path. Each invocation obtains its own token using the supplied credentials or uses an explicitly supplied access token. Secrets and tokens stay out of the profile.

## Connection options

| Option | Environment variable | Purpose |
| --- | --- | --- |
| `--server URL` | `KC_SERVER` | Keycloak base URL, including any deployment prefix such as `/auth`. |
| `--realm REALM` | `KC_AUTH_REALM` | Realm used for authentication. Defaults to `master`. |
| `-r`, `--target-realm REALM` | | Realm to manage. Defaults to the authentication realm. Pass it explicitly for realm-scoped writes. |
| `--client ID` | `KC_CLIENT_ID` | Authentication client ID. Defaults to `admin-cli` for username-based login. |
| `--user NAME` | `KC_USER` | Username for the password grant. |
| `--password PASSWORD` | `KC_CLI_PASSWORD` | Password for the password grant. |
| `--secret SECRET` | `KC_CLIENT_SECRET`, fallback `KC_CLI_CLIENT_SECRET` | Client secret. |
| `--token TOKEN` | `KC_ACCESS_TOKEN` | Existing bearer token for management commands. Takes precedence over credential grants. |
| `--config FILE` | `KC_CONFIG` | Profile path. Defaults to `~/.config/kcadm-node/config.json`. |
| `--no-config` | | Skip reading the saved profile on a management command. |

Flags override environment variables, which override saved profile values. Use the environment for passwords, secrets, and tokens. With no bearer token, a configured username selects the password grant. With no username, the CLI uses the client credentials grant.

## Resource commands

Run `kcadm-node get|create|update|delete ENDPOINT [options]`, choosing one command. An endpoint like `users/ID` is relative to `/admin/realms/REALM/`. The roots `realms` and `serverinfo` are relative to `/admin/`. For example, `realms/demo` selects `demo` in the path itself. In `clients/ID` paths, use the internal client ID returned by Keycloak.

| Option | Commands | Behavior |
| --- | --- | --- |
| `-q`, `--query KEY=VALUE` | All four | Append a query parameter. Repeat for multiple parameters. |
| `-o`, `--offset OFFSET` | `get` | Set `first`, overriding any `-q first=...`. |
| `-l`, `--limit LIMIT` | `get` | Set `max`, overriding any `-q max=...`. A call requests one page. |
| `-F`, `--fields FIELD[,FIELD...]` | All four | Select top-level JSON fields on each object. On writes, use with `--output`. |
| `-c`, `--compressed` | All four | Print compact JSON. On writes, use with `--output`. |
| `-f`, `--file FILE` | `create`, `update`, `delete` | Read JSON from a file. Use `-f -` to read stdin. |
| `-s`, `--set KEY=VALUE` | `create`, `update`, `delete` | Set a property after loading the input body. Repeat for multiple assignments. Dotted keys address nested objects. |
| `-m`, `--merge` | `update` | Read the current object, overlay file properties at the top level, apply assignments, and send the result. |
| `-n`, `--no-merge` | `update` | Send a direct PUT with the supplied body and assignments. |
| `-i`, `--id` | `create` | Print the resource ID from the response's `Location` header. Mutually exclusive with `--output`. |
| `-o`, `--output` | `create`, `update`, `delete` | Print the response body when present. Create and update can issue a follow-up GET for the saved resource. |
| `--server-version MAJOR.MINOR.PATCH` | `get` | Enable version-specific behavior for `groups/ID/children`. Overrides `KC_SERVER_VERSION`. |

Without `-m` or `-n`, `update` merges when you supply `-s` without a file. With `-f`, the file is the outgoing payload by default, with any `-s` assignments applied on top. `-s` parses valid JSON values and uses other values as strings. For example, `-s enabled=false` sets a boolean, and `-s 'attributes.team=["Core"]'` sets an array. Writes are silent by default. A failed ID lookup or readback can report an error after the write succeeds. Check remote state before retrying.

```sh
kcadm-node get users -r demo -o 0 -l 20 -F id,username
kcadm-node update "users/$USER_ID" -r demo -s 'attributes.team=["Core"]' -o
```

## User role commands

| Option | Commands | Behavior |
| --- | --- | --- |
| `--uid ID` or `--uusername NAME` | `get-roles`, `add-roles`, `remove-roles` | Select exactly one user by internal ID or exact username. |
| `--cid ID` or `--cclientid CLIENT_ID` | All three | Select a client by internal ID or public client ID. Omit both for realm roles. |
| `--effective` or `--available` | `get-roles` | List effective roles including composite mappings, or roles available to map. Omit both for direct mappings. |
| `--rolename NAME` | `add-roles`, `remove-roles` | Specify at least one role name. Repeat for multiple roles in the selected scope. |

```sh
kcadm-node add-roles -r demo --uid "$USER_ID" --cclientid example --rolename reader
kcadm-node get-roles -r demo --uid "$USER_ID" --cclientid example
```

## Compatibility scope

The official CLI's wider surface includes absolute endpoints, CSV and nested projection, Java truststore options, and group or composite role shortcuts. These remain outside the first version's compatibility scope.

For `get groups/ID/children`, supply `--server-version` or `KC_SERVER_VERSION` to normalize `briefRepresentation` on 23.0.0–23.0.3 and apply search locally on 23 and 24. Without a version the request retains the server's native behavior. The patch cutoff comes from upstream source. The matrix samples the initial release of each major.

User attribute handling depends on the Realm's User Profile. Verify a custom attribute by reading the user after writing it.

## Local development

Use Node.js 22 or later. The CLI and project tooling use TypeScript and Node.js.
Keep Python source files and runtime dependencies out of the project.

```sh
npm ci
npm test
node dist/cli.js --help
```

Run `npm run test:coverage` to measure line, branch, and function coverage of
the compiled CLI. The local suite exercises the command through a loopback
HTTP fixture. Use the server matrix below to check Keycloak behavior.

The npm package version follows the pinned `@keycloak/keycloak-admin-client` version. A release candidate appends `-rc.N`, starting at `-rc.1` for each SDK version. For example, `kcadm-node@26.8.2-rc.1` uses SDK `26.8.2`. The SDK version identifies the client library. See the compatibility tests below for the Keycloak server versions exercised by this project.

## Server compatibility tests

The matrix uses fresh local dev instances of Keycloak `23.0.0`, `24.0.0`, `25.0.0`, and `26.0.0`. Download and extract the corresponding [official distributions](https://github.com/keycloak/keycloak/releases) into a directory with one `keycloak-VERSION` subdirectory per release. Use Java 17 for 23/24 and Java 21 for 25/26. The npm script builds the CLI, type-checks the runner, and runs `test/integration/run.ts` directly with Node.js.

```sh
KC_MATRIX_SERVERS=/path/to/distributions \
KC_MATRIX_JAVA17=/path/to/java-17 \
JAVA_HOME=/path/to/java-21 \
npm run test:matrix
```

The runner copies distributions to temporary directories, starts servers on loopback, and records the SDK and CLI results under `test/integration/results/`. Known raw SDK differences must reproduce while the CLI and workaround checks must pass. The matrix also compares selected Client query and update output against the official CLI bundled with each distribution.

See the [commit rules](docs/00-governance/COMMIT-RULES.md) and [PR rules](docs/00-governance/PR-RULES.md) for repository workflow.
