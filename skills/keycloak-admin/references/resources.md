# Admin REST resource commands

Pass one relative endpoint. Paths such as `users/ID`, `clients/ID`, and
`roles/NAME` resolve under `/admin/realms/REALM/`. The roots `realms` and
`serverinfo` resolve under `/admin/`, so select a specific realm with a path
such as `realms/demo`. Encode dynamic path segments where needed and put query
parameters in repeated `-q key=value` flags. Use internal client IDs in paths.

| Command | HTTP method | Options and output |
| --- | --- | --- |
| `get ENDPOINT` | GET | `-q` for query parameters, `-o OFFSET` for `first`, `-l LIMIT` for `max`, `-F id,name` for top-level fields, `-c` for compact JSON |
| `create ENDPOINT` | POST | `-f FILE` or `-f -` for a JSON body, repeatable `-s` for assignments, `-i` for the ID from the Location header, or `-o` for output |
| `update ENDPOINT` | PUT | Same body flags, `-m` or `-n` to control merging, and `-o` for output |
| `delete ENDPOINT` | DELETE | Optional JSON body via `-f` or `-s`, and `-o` for the response body |

All four commands accept `-q`. On writes, `-F` and `-c` format JSON output
when requested with `-o`. Create and update may perform a readback for
`-o`. A successful write can still produce an error if its ID or readback
cannot be obtained. Ordinary writes are silent by default. Errors go to
stderr with exit status 1.

## Resolve a target

```sh
kcadm-node get users -r demo -q username=alice -q exact=true -F id,username
kcadm-node get clients -r demo -q clientId=example -F id,clientId
```

Check the returned name or public client ID against the requested value and
require one match. Follow pagination if the endpoint can return additional
matches. `-o` and `-l` on `get` request one page at a time and override
`first` and `max` supplied through `-q`.

## Build a write payload

- `-s key=value` parses valid JSON values as their JSON types and uses a
  string for other values. Use `-s 'attributes.code=["123"]'` for a string
  array. Use `-s 'description="123"'` to keep a scalar value as a string.
- Dotted keys set nested object properties. Assignments apply in order after
  loading the file or stdin body. A dotted path requires object parents.
- An update with assignments and no file merges by default. The CLI reads the
  current object and applies assignments before sending the PUT.
- An update with a file or stdin sends that payload by default. `-m` first
  reads the current object and overlays file properties at the top level,
  replacing nested values at those keys. Dotted assignments then apply.
- Use `-n` for a direct PUT, including non-object payloads and subresource
  operations that do not need a pre-read. For a direct write with no file or
  assignments, create and update send `{}`. Delete sends no body by default.

```sh
kcadm-node create users -r demo -s username=alice -s enabled=true -i
kcadm-node update "users/$USER_ID" -r demo -s firstName=Alice
kcadm-node update "users/$USER_ID" -r demo -f "$PAYLOAD_FILE" -m
kcadm-node get "users/$USER_ID" -r demo -F id,username,firstName,attributes
```

Use `delete "users/$USER_ID" -r demo` for a requested deletion after
confirming the ID. The merge sequence is a GET followed by PUT. Account for
concurrent edits when preparing the update.
