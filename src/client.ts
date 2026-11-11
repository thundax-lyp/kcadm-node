import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import KeycloakAdminClient from '@keycloak/keycloak-admin-client'

export type ConnectionOptions = {
  server?: string
  realm?: string
  client?: string
  user?: string
  password?: string
  secret?: string
  token?: string
  config?: string
  'no-config'?: boolean
}

type Profile = { server: string; realm: string; client: string; user?: string }

function configPath(options: ConnectionOptions) {
  return options.config ?? process.env.KC_CONFIG ?? join(homedir(), '.config', 'kcadm-node', 'config.json')
}

async function loadProfile(options: ConnectionOptions): Promise<Partial<Profile>> {
  if (options['no-config']) return {}
  try {
    return JSON.parse(await readFile(configPath(options), 'utf8')) as Profile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function saveProfile(options: ConnectionOptions, profile: Profile) {
  const path = configPath(options)
  const temporary = path + '.' + randomUUID()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function connect(options: ConnectionOptions, configure = false) {
  const saved = configure ? {} : await loadProfile(options)
  const server = options.server ?? process.env.KC_SERVER ?? saved.server
  const realm = options.realm ?? process.env.KC_AUTH_REALM ?? saved.realm ?? 'master'
  const user = options.user ?? process.env.KC_USER ?? saved.user
  const client = options.client ?? process.env.KC_CLIENT_ID ?? saved.client ?? (user ? 'admin-cli' : undefined)
  const password = options.password ?? process.env.KC_CLI_PASSWORD
  const secret = options.secret ?? process.env.KC_CLIENT_SECRET ?? process.env.KC_CLI_CLIENT_SECRET
  const token = options.token ?? process.env.KC_ACCESS_TOKEN
  if (!server || (!token && !client)) throw new Error('Set --server and either --client or --token')
  if (configure && token) throw new Error('Use --token on a management command')
  const url = new URL(server)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The server must be an HTTP(S) base URL without credentials, query or fragment')
  }
  if (!token && (user ? !password : !secret)) {
    throw new Error(user ? 'Set KC_CLI_PASSWORD or --password' : 'Set KC_CLIENT_SECRET or --secret')
  }
  const baseUrl = url.href.replace(/\/+$/, '')
  const kc = new KeycloakAdminClient({
    baseUrl, realmName: realm, requestOptions: { redirect: 'error' }, timeout: 30_000,
  })
  if (token) kc.setAccessToken(token)
  else await kc.auth({
    clientId: client!, clientSecret: secret,
    ...(user ? { grantType: 'password', username: user, password } : { grantType: 'client_credentials' }),
  })
  return { kc, profile: { server: baseUrl, realm, client: client ?? '', user } }
}
