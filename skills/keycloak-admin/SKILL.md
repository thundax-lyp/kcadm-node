---
name: keycloak-admin
description: Query and manage Keycloak resources, user roles, and group memberships with kcadm-node.
---

# Keycloak administration

Use Node.js 22 or later. The sibling `package.json` declares the published
`kcadm-node` dependency and the `kcadm` script that runs it. Set `SKILL_DIR`
to the absolute path of the directory containing this SKILL.md. Install the
locked dependency there before first use and check the CLI help.

```sh
npm --prefix "$SKILL_DIR" ci --registry=https://registry.npmjs.org
npm --prefix "$SKILL_DIR" run --silent kcadm -- --help
```

In each reference example, replace the leading `kcadm-node` with
`npm --prefix "$SKILL_DIR" run --silent kcadm --` and pass the remaining
arguments as shown. The silent flag keeps npm script banners out of JSON
output. npm runs the script from `SKILL_DIR`, so use absolute paths for `-f`,
`--config`, and `KC_CONFIG` when they refer to files outside that directory.

For a read with credentials already available, substitute the requested
realm and lookup value in this example.

```sh
npm --prefix "$SKILL_DIR" run --silent kcadm -- get users \
  -r demo -q username=alice -q exact=true -F id,username
```

## Reference routing

Choose a reference for each operation by what it reads or changes. Resolve
paths relative to this SKILL.md and read the selected file before composing
the command. A request with several operations can use several references.

- For assigning roles to a user or inspecting their direct, effective, or
  available realm or client roles, read [role-mappings.md](references/role-mappings.md).
- For subgroup browsing, group member queries, or adding or removing a user
  from a group, read [groups.md](references/groups.md).
- For other Admin REST reads or writes, including edits to role definitions,
  and for generic CLI flags or payload and merge behavior, read
  [resources.md](references/resources.md).

Read [connection.md](references/connection.md) before the first request when
selecting or troubleshooting credentials, a profile, or the authentication
realm. For a write, read [verification.md](references/verification.md) before
issuing it so you can plan the readback. Use the same reference to decide the
next step after a timeout or failed readback.

For example, creating a user and granting a client role uses resources.md
for the create, role-mappings.md for the grant, and verification.md to plan
the checks for both operations.

## Execution

1. Establish the instance, authentication realm, and target realm using the
   supplied connection settings. Use `-r REALM` explicitly for realm-scoped
   writes. For realm-level paths such as `realms/demo`, verify the target in the
   path itself. Keep credentials in the execution environment.
2. For a change to an existing resource, resolve any supplied name to one
   exact match and use its internal ID for subsequent calls. If the target is
   missing or ambiguous, stop before writing and report what the lookup found.
   For a create, resolve any parent or referenced resource and capture the new
   resource ID when the endpoint returns one.
3. Apply the requested change using the relevant command. Choose update merge
   behavior deliberately. For role changes compare direct mappings, and for
   membership changes inspect the user's groups.
4. Read back the affected state and report what was observed. After an uncertain
   write, verify remote state before retrying. If verification is unavailable,
   report the outcome as unknown.
