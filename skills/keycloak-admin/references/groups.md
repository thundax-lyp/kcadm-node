# Groups and memberships

Look up groups using `get groups` or browse a parent using
`get "groups/$PARENT_ID/children"`. Check the group path or parent when names
repeat. Use the resolved group ID for writes.

```sh
kcadm-node get groups -r demo -q search=engineering -F id,name,path
kcadm-node get "groups/$PARENT_ID/children" -r demo \
  --server-version "$SERVER_VERSION" -q search=platform -q exact=true -l 25
kcadm-node get "groups/$GROUP_ID/members" -r demo -o 0 -l 25 -F id,username
```

## Subgroup compatibility

Pass the known server version as `--server-version MAJOR.MINOR.PATCH` or
`KC_SERVER_VERSION` for `groups/ID/children`. Without it, the CLI forwards
the query to Keycloak as supplied.

- On 23.0.0 through 23.0.3 the CLI compensates for inverted
  `briefRepresentation` handling.
- For search on Keycloak 23 and 24, it reads subgroup pages and filters names
  locally, case-insensitively. `exact=true` selects equality and the default
  selects substring matching. The requested offset and limit apply after
  filtering and default to 0 and 10 for this workaround.
- On 25 and later, subgroup search is handled by the server.

## Change membership

```sh
kcadm-node get "users/$USER_ID/groups" -r demo -F id,name,path
kcadm-node update "users/$USER_ID/groups/$GROUP_ID" -r demo -n
kcadm-node get "users/$USER_ID/groups" -r demo -F id,name,path
```

To remove membership, use
`kcadm-node delete "users/$USER_ID/groups/$GROUP_ID" -r demo` and read the
user's groups again. Compare IDs and check relevant pages before concluding
that a membership is absent.
