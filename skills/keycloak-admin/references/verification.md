# Verify mutations and handle uncertain results

Use the same server, target realm, and resource IDs for verification. Check
the requested field, relationship, or absence directly. For a deletion, use
a targeted read and interpret a 404 in the context of the endpoint, permissions,
and pre-write lookup.

| Operation | Verification |
| --- | --- |
| Create | Read by the returned ID. If the ID is unavailable, look up by a unique identifier in the same realm. |
| Update | Read by ID and compare the requested values. |
| Delete | Read by ID or query the collection using the original identity. |
| Grant or revoke a user role | List direct mappings in the same realm or client scope. |
| Add or remove a user from a group | Read the user's groups and compare the group ID. |

Keycloak can accept a user update and omit an unmanaged attribute. Inspect
the stored attributes. If the value is missing, report the observed state
and inspect the Realm's User Profile policy if authorized. Treat a change
to that policy as a separate operation.

If a mutation times out, loses its response, or reports that the write
succeeded but readback failed, inspect the remote state before attempting
another write. A create can also succeed without the ID that `-i` needs.
If the requested state is present, report it. If the state is definitively
unchanged, determine whether the original failure is recoverable and retry
only when the existing authorization and operation semantics permit it.
If the state cannot be established, report an unknown outcome and the
verification attempted.
