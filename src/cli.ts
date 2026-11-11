#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { connect, saveProfile } from './client.js'
import { resources, type ResourceCommand } from './resources.js'
import { roles, type RoleCommand } from './roles.js'

const connection = {
  server: { type: 'string' },
  realm: { type: 'string' },
  client: { type: 'string' },
  user: { type: 'string' },
  password: { type: 'string' },
  secret: { type: 'string' },
  token: { type: 'string' },
  config: { type: 'string' },
  'no-config': { type: 'boolean' },
} as const
const target = { 'target-realm': { type: 'string', short: 'r' } } as const
const query = { query: { type: 'string', short: 'q', multiple: true } } as const
const display = {
  fields: { type: 'string', short: 'F' },
  compressed: { type: 'boolean', short: 'c' },
} as const
const input = {
  set: { type: 'string', short: 's', multiple: true },
  file: { type: 'string', short: 'f' },
  output: { type: 'boolean', short: 'o' },
  ...display,
} as const
const roleTarget = {
  uid: { type: 'string' },
  uusername: { type: 'string' },
  cid: { type: 'string' },
  cclientid: { type: 'string' },
} as const
const roleNames = { rolename: { type: 'string', multiple: true } } as const
const options = {
  config: {},
  get: { ...query, ...display, offset: { type: 'string', short: 'o' },
    limit: { type: 'string', short: 'l' }, 'server-version': { type: 'string' } },
  create: { ...query, ...input, id: { type: 'boolean', short: 'i' } },
  update: { ...query, ...input, merge: { type: 'boolean', short: 'm' }, 'no-merge': { type: 'boolean', short: 'n' } },
  delete: { ...query, ...input },
  'get-roles': { ...roleTarget, effective: { type: 'boolean' }, available: { type: 'boolean' } },
  'add-roles': { ...roleTarget, ...roleNames },
  'remove-roles': { ...roleTarget, ...roleNames },
} as const satisfies Record<string, ParseArgsConfig['options']>
type Command = keyof typeof options
const help = `Usage: kcadm-node <command> [options]

  config credentials --server URL --realm REALM --client CLIENT
  get ENDPOINT [-q key=value] [-F key,key] [-o OFFSET] [-l LIMIT] [--server-version VERSION]
  create ENDPOINT [-q key=value] [-s key=value] [-f FILE] [-i] [-o]
  update ENDPOINT [-q key=value] [-s key=value] [-f FILE] [-m | -n] [-o]
  delete ENDPOINT [-q key=value] [-s key=value] [-f FILE] [-o]
  get-roles (--uid ID | --uusername NAME) [--cid ID | --cclientid NAME]
            [--effective | --available]
  add-roles, remove-roles: same target options, with repeatable --rolename NAME

  -r, --target-realm REALM  Realm to manage
  --realm REALM            Realm to authenticate against
  --server, --client, --user, --password, --secret, --token, --config, --no-config
  Environment: KC_SERVER, KC_AUTH_REALM, KC_CLIENT_ID, KC_CLIENT_SECRET,
               KC_USER, KC_CLI_PASSWORD, KC_ACCESS_TOKEN, KC_CONFIG, KC_SERVER_VERSION
  -f - reads JSON from stdin
`

async function main(args: string[]) {
  const [command, ...rest] = args
  if (!command || ['help', '--help', '-h'].includes(command) || rest.includes('--help')) {
    console.log(help.trimEnd())
    return
  }
  if (!Object.hasOwn(options, command)) throw new Error(`Unknown command: ${command}`)
  const parsed = parseArgs({
    args: rest, allowPositionals: true,
    options: { ...connection, ...(command === 'config' ? {} : target), ...options[command as Command] },
  })
  const values = parsed.values as import('./client.js').ConnectionOptions
    & import('./resources.js').ResourceOptions & import('./roles.js').RoleOptions
    & { 'target-realm'?: string; 'server-version'?: string }
  const [endpoint] = parsed.positionals
  if (command === 'config') {
    if (endpoint !== 'credentials' || parsed.positionals.length !== 1) throw new Error('Use config credentials')
    if (values['no-config']) throw new Error('Use --no-config on a management command')
    const { profile } = await connect(values, true)
    await saveProfile(values, profile)
    return
  }
  const isRoleCommand = command.endsWith('-roles')
  if (parsed.positionals.length !== (isRoleCommand ? 0 : 1)) {
    throw new Error(isRoleCommand ? 'Role commands take named options only' : 'Specify one Admin REST endpoint')
  }
  if (values.id && values.output) throw new Error('Use either -i or -o')
  if (values.merge && values['no-merge']) throw new Error('Use either -m or -n')
  if (values.fields && !/^[\w-]+(?:,[\w-]+)*$/.test(values.fields)) {
    throw new Error('--fields supports comma-separated top-level names')
  }
  const { kc, profile } = await connect(values)
  const realm = values['target-realm'] ?? profile.realm
  if (isRoleCommand) await roles(kc, realm, command as RoleCommand, values)
  else await resources(kc, realm, command as ResourceCommand, endpoint, values)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const response = (error as { response?: Response } | null)?.response
  const message = response
    ? `Keycloak returned HTTP ${response.status}`
    : error instanceof Error ? error.message : 'Unexpected error'
  console.error(message)
  process.exitCode = 1
})
