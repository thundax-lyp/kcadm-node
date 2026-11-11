---
name: keycloak-admin
description: Manage a Keycloak instance with kcadm-node. Use when asked to query or change Keycloak users, clients, realms, role mappings, groups, or group memberships.
---

# Keycloak administration

Use the local CLI build during development. From the kcadm-node checkout, run `npm ci` and `npm run build` if the build is missing, then invoke `node dist/cli.js`. If a matching CLI is already installed, use `kcadm-node`. Run `--help` to check the supported kcadm options.

Use the provided connection settings. Service accounts use `KC_SERVER`, `KC_AUTH_REALM`, `KC_CLIENT_ID`, and `KC_CLIENT_SECRET`. An existing access token can be supplied via `KC_ACCESS_TOKEN`. Keep credentials in the execution environment. `--realm` selects the authentication realm and `-r` selects the realm to manage. Pass `-r` explicitly for realm-scoped changes.

Find resources before changing them. Prefer a stable ID from an exact lookup, and resolve any ambiguity before acting. For example, use `get users -r demo -q username=alice -q exact=true -F id,username`. Use the internal Client ID in resource paths, and pass the public `clientId` to `--cclientid` when working with roles.

- Use `get`, `create`, `update`, and `delete` with relative Admin REST resource paths. Use `create ... -i` to capture an ID. For updates, `-s` merges by default and `-f` replaces the payload by default. Add `-m` to merge a file with the current resource.
- Use `get-roles`, `add-roles`, and `remove-roles` with `--uid` or `--uusername`, and repeat `--rolename` for multiple roles. Add `--cid` or `--cclientid` for client roles. Compare direct mappings before and after a grant or revocation.
- For child group listing, use `get groups/ID/children -r REALM --server-version VERSION` with the known server version to normalize older server behavior. For membership use `update users/USER_ID/groups/GROUP_ID -r REALM -n` to add and `delete` on the same resource to remove.
- Read the resource back after mutations. Keycloak can return success and omit an unmanaged user attribute. Report the observed state and check the Realm's User Profile policy if permitted. Changing that policy is a separate operation.
- If a write times out or its response is lost, read the resource or mapping before retrying. If the result remains unknown, say so.
