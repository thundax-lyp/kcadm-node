# Connection and authentication

Use the server's base URL including any deployment prefix such as `/auth`.
Supply an HTTP(S) URL without embedded credentials, query, or fragment.

| Setting | Environment | Flag |
| --- | --- | --- |
| Server base URL | `KC_SERVER` | `--server` |
| Authentication realm | `KC_AUTH_REALM` | `--realm` |
| Authentication client ID | `KC_CLIENT_ID` | `--client` |
| Username | `KC_USER` | `--user` |
| Password | `KC_CLI_PASSWORD` | `--password` |
| Client secret | `KC_CLIENT_SECRET` (fallback `KC_CLI_CLIENT_SECRET`) | `--secret` |
| Existing access token | `KC_ACCESS_TOKEN` | `--token` |
| Profile file | `KC_CONFIG` | `--config` |

Inject secrets through the execution environment so they stay out of command
arguments, logs, repository files, and artifacts. Prefer the connection
settings already provided for the task.

- **Service account.** Supply the server, authentication realm, client ID, and
  client secret. Ensure there is no effective username or token when selecting
  the client credentials grant.
- **Password grant.** Supply the server, authentication realm, username, and
  password. Use a client that permits the grant. The client defaults to
  `admin-cli` when a username is present and there is no configured client.
  Supply the client secret if the client requires one.
- **Existing token.** Supply the server and token for the management command.
  The token takes precedence over the password and service account grants.

Connection flags override environment settings, which override saved profile
values. The authentication realm defaults to `master`. Realm-scoped commands
default to that effective authentication realm if `-r` is omitted. Pass
`-r` explicitly on writes. `--no-config` on a management command skips saved
profile loading. It still uses flags and the environment.

## Local profile

```sh
kcadm-node config credentials --config "$PROFILE" \
  --server "$KC_SERVER" --realm "$KC_AUTH_REALM" --client "$KC_CLIENT_ID"
kcadm-node get users --config "$PROFILE" -r demo -l 1 -F id
```

`config credentials` authenticates using the current flags and environment
before saving the server, authentication realm, client ID, and optional
username. It replaces the selected profile and defaults to
`~/.config/kcadm-node/config.json`. Supply credentials again for later calls.
Use bearer tokens directly with management commands.
