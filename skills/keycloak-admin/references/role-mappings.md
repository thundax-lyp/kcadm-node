# User role mappings

Use `get-roles`, `add-roles`, and `remove-roles` for user assignments.
Use resource commands on `roles` or `clients/ID/roles` for role definitions.

- Supply exactly one of `--uid ID` and `--uusername NAME`. The username
  lookup requires one exact match. Reuse a resolved ID across reads and writes.
- Omit client options for realm roles. For client roles, choose
  `--cid INTERNAL_ID` or `--cclientid PUBLIC_CLIENT_ID`. The latter requires
  one exact public client ID match.
- `get-roles` lists direct mappings by default. Use `--effective` for the
  server's composite-expanded view or `--available` for roles the server
  returns as available to map. These options are mutually exclusive.
- Repeat `--rolename NAME` for grant or revocation. The CLI resolves role
  names in the selected scope before submitting the mapping change.

```sh
kcadm-node get-roles -r demo --uid "$USER_ID"
kcadm-node add-roles -r demo --uid "$USER_ID" --rolename support
kcadm-node get-roles -r demo --uid "$USER_ID"

kcadm-node get-roles -r demo --uid "$USER_ID" --cclientid example
kcadm-node remove-roles -r demo --uid "$USER_ID" --cclientid example \
  --rolename reader --rolename writer
kcadm-node get-roles -r demo --uid "$USER_ID" --cclientid example
```

Compare direct mappings in the same scope before and after the write.
Effective roles can still be present via other mappings or group membership
after a direct revocation. Report the direct and effective results if both
matter to the user's goal.
