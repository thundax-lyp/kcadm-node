import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const invokeWithEnv = (env, ...args) =>
  exec(process.execPath, [cli, ...args], {
    timeout: 40_000,
    env: {
      PATH: process.env.PATH,
      ...(process.env.NODE_V8_COVERAGE && { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }),
      ...env,
    },
  })
const invoke = (...args) => invokeWithEnv({}, ...args)

async function mockServer(t, respond) {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const entry = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString(),
    }
    requests.push(entry)
    const reply = respond(entry)
    if (!reply) return response.writeHead(404).end()
    if (reply.disconnect) return response.destroy()
    if (reply.hang) return
    const { status = 200, json, raw, headers = {} } = reply
    if (json !== undefined) response.setHeader('Content-Type', 'application/json')
    response.writeHead(status, headers).end(json === undefined ? raw : JSON.stringify(json))
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/auth'
  const connection = ['--server', base, '--token', 'test-token', '--no-config', '-r', 'demo']
  return { base, connection, requests }
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kcadm-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function rejectsCli(result, message) {
  return assert.rejects(result, error => error.code === 1 && message.test(error.stderr))
}

test('help and argument errors work before making a connection', async () => {
  for (const args of [[], ['help'], ['--help'], ['-h'], ['get', '--help']]) {
    assert.match((await invoke(...args)).stdout, /config credentials/)
  }
  for (const args of [
    ['unknown-command'],
    ['get', 'users', '--unknown'],
    ['get'],
    ['create', 'users', '-i', '-o'],
    ['get', 'users', '--fields', 'attributes(*)'],
    ['update', 'users/id', '-m', '-n'],
  ]) {
    await assert.rejects(invoke(...args), error => error.code === 1 && error.stderr.length > 0)
  }
})

test('update merges dotted fields by default and honors a file without GET', async t => {
  const { connection, requests } = await mockServer(t, request => {
    if (request.authorization !== 'Bearer test-token') return { status: 401 }
    if (request.method === 'GET') return { json: { attributes: { old: ['keep'], sample: ['old'] } } }
    return { status: 204 }
  })
  await invoke('update', 'users/id', ...connection, '-s', 'attributes.sample=["new"]')
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/auth/admin/realms/demo/users/id'],
    ['PUT', '/auth/admin/realms/demo/users/id'],
  ])
  assert.deepEqual(JSON.parse(requests[1].body), { attributes: { old: ['keep'], sample: ['new'] } })
  requests.length = 0

  const result = invoke('update', 'users/id', ...connection, '-f', '-')
  result.child.stdin.end('{"enabled":false}')
  await result
  assert.deepEqual(requests.map(({ method, body }) => [method, JSON.parse(body)]), [['PUT', { enabled: false }]])
  requests.length = 0
  await assert.rejects(invoke('get', 'users/../clients', ...connection), /relative Keycloak Admin REST endpoint/)
  assert.equal(requests.length, 0)
})

test('get passes repeated query parameters, overrides pagination, and projects compact JSON', async t => {
  const { connection, requests } = await mockServer(t, () => ({
    json: [{ id: 'u1', username: 'alice', enabled: true }],
  }))
  const { stdout } = await invoke('get', 'users', ...connection,
    '-q', 'q=team:Core Ops', '-q', 'q=region:eu', '-q', 'max=99',
    '-o', '3', '-l', '2', '-F', 'id,username,missing', '-c')
  assert.equal(stdout, '[{"id":"u1","username":"alice"}]\n')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].authorization, 'Bearer test-token')
  const url = new URL(requests[0].url, 'http://localhost')
  assert.equal(url.pathname, '/auth/admin/realms/demo/users')
  assert.deepEqual([...url.searchParams], [
    ['q', 'team:Core Ops'], ['q', 'region:eu'], ['max', '2'], ['first', '3'],
  ])
})

test('explicit merge overlays JSON input at the top level before applying dotted assignments', async t => {
  const { connection, requests } = await mockServer(t, request => request.method === 'GET'
    ? { json: { enabled: true, attributes: { stale: ['remove'] } } }
    : { status: 204 })
  const result = invoke('update', 'users/id', ...connection, '-f', '-', '-m', '-s', 'attributes.region=eu')
  result.child.stdin.end('{"attributes":{"team":["Core"]}}')
  await result
  assert.deepEqual(requests.map(request => request.method), ['GET', 'PUT'])
  assert.deepEqual(JSON.parse(requests[1].body), {
    enabled: true, attributes: { team: ['Core'], region: 'eu' },
  })
})

test('config authenticates with the service account and saves a profile without credentials', async t => {
  const { base, requests } = await mockServer(t, request => {
    if (request.url === '/auth/realms/login/protocol/openid-connect/token') {
      return { json: { access_token: 'fixture-token' } }
    }
    if (request.url === '/auth/admin/realms/demo/users') return { json: [] }
  })
  const directory = await temporaryDirectory(t)
  const profile = join(directory, 'config.json')
  const env = { KC_CONFIG: profile, KC_CLIENT_SECRET: 'fixture-secret' }
  await invokeWithEnv(env, 'config', 'credentials', '--server', base, '--realm', 'login', '--client', 'worker')
  assert.deepEqual(JSON.parse(await readFile(profile, 'utf8')), { server: base, realm: 'login', client: 'worker' })

  await invokeWithEnv(env, 'get', 'users', '-r', 'demo')
  const [configure, authenticate, read] = requests
  assert.equal(requests.length, 3)
  for (const request of [configure, authenticate]) {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/auth/realms/login/protocol/openid-connect/token')
    const form = new URLSearchParams(request.body)
    assert.equal(form.get('grant_type'), 'client_credentials')
    assert.equal(form.get('client_id'), 'worker')
  }
  assert.equal(read.url, '/auth/admin/realms/demo/users')
  assert.equal(read.authorization, 'Bearer fixture-token')
})

test('create returns a decoded ID and update output reads back the saved resource', async t => {
  const { connection, requests } = await mockServer(t, request => {
    if (request.method === 'POST') {
      return { status: 201, headers: { Location: '/auth/admin/realms/demo/users/u%201' } }
    }
    if (request.method === 'PUT') return { status: 204 }
    return { json: { id: 'u 1', enabled: false, username: 'alice' } }
  })
  const created = await invoke('create', 'users', ...connection, '-i', '-s', 'username=alice')
  assert.equal(created.stdout, 'u 1\n')
  const updated = await invoke('update', 'users/u%201', ...connection,
    '-n', '-s', 'enabled=false', '-q', 'example=true', '-o', '-F', 'id,enabled')
  assert.deepEqual(JSON.parse(updated.stdout), { id: 'u 1', enabled: false })
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', '/auth/admin/realms/demo/users'],
    ['PUT', '/auth/admin/realms/demo/users/u%201?example=true'],
    ['GET', '/auth/admin/realms/demo/users/u%201'],
  ])
  assert.deepEqual(JSON.parse(requests[0].body), { username: 'alice' })
  assert.deepEqual(JSON.parse(requests[1].body), { enabled: false })
})

test('reports a failed readback without resubmitting a successful write', async t => {
  const { connection, requests } = await mockServer(t, request =>
    ({ status: request.method === 'PUT' ? 204 : 403 }))
  await assert.rejects(invoke('update', 'users/id', ...connection, '-n', '-o'),
    error => error.code === 1 && /Write succeeded but readback failed: .*HTTP 403/.test(error.stderr))
  assert.deepEqual(requests.map(request => request.method), ['PUT', 'GET'])
})

test('realm deletion uses the global endpoint and omits the request body', async t => {
  const { connection, requests } = await mockServer(t, () => ({ status: 204 }))
  const { stdout } = await invoke('delete', 'realms/obsolete', ...connection)
  assert.equal(stdout, '')
  assert.deepEqual(requests.map(({ method, url, body }) => [method, url, body]), [
    ['DELETE', '/auth/admin/realms/obsolete', ''],
  ])
})

test('legacy subgroup search filters before applying pagination', async t => {
  const { connection, requests } = await mockServer(t, () => ({
    json: [{ name: 'Team-alt' }, { name: 'TEAM', id: 'first' }, { name: 'team', id: 'second' }],
  }))
  const { stdout } = await invoke('get', '/%67roups/parent/children/', ...connection,
    '--server-version', '23.0.3', '-q', 'search=team', '-q', 'exact=true',
    '-q', 'briefRepresentation=false', '-o', '1', '-l', '1', '-F', 'id')
  assert.deepEqual(JSON.parse(stdout), [{ id: 'second' }])
  assert.deepEqual(requests.map(request => request.url), [
    '/auth/admin/realms/demo/groups/parent/children?briefRepresentation=true&first=0&max=100',
  ])
})

test('client role commands resolve public client IDs and submit direct mappings', async t => {
  const prefix = '/auth/admin/realms/demo'
  const mapping = prefix + '/users/u1/role-mappings/clients/c1'
  const role = { id: 'r1', name: 'reader' }
  const { connection, requests } = await mockServer(t, request => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.replace(/\/$/, '') === prefix + '/clients' && url.searchParams.get('clientId') === 'example') {
      return { json: [{ clientId: 'example-alt', id: 'other' }, { clientId: 'example', id: 'c1' }] }
    }
    if (request.url === prefix + '/clients/c1/roles/reader') return { json: role }
    if ([mapping, mapping + '/available', mapping + '/composite'].includes(request.url) && request.method === 'GET') {
      return { json: [role] }
    }
    if (request.url === mapping && ['POST', 'DELETE'].includes(request.method)) return { status: 204 }
  })
  const target = [...connection, '--uid', 'u1', '--cclientid', 'example']
  await invoke('add-roles', ...target, '--rolename', 'reader', '--rolename', 'reader')
  const effective = await invoke('get-roles', ...target, '--effective')
  assert.deepEqual(JSON.parse(effective.stdout), [role])
  const directTarget = [...connection, '--uid', 'u1', '--cid', 'c1']
  for (const flags of [[], ['--available']]) {
    assert.deepEqual(JSON.parse((await invoke('get-roles', ...directTarget, ...flags)).stdout), [role])
  }
  await invoke('remove-roles', ...target, '--rolename', 'reader')
  assert.deepEqual(requests.filter(request => request.method !== 'GET')
    .map(({ method, url, body }) => [method, url, JSON.parse(body)]), [
    ['POST', mapping, [role]], ['DELETE', mapping, [role]],
  ])
  assert.equal(requests.filter(request => request.url.endsWith('/roles/reader')).length, 2)
})

test('password authentication honors flags over environment and profile defaults', async t => {
  const { base, requests } = await mockServer(t, request =>
    request.method === 'POST' ? { json: { access_token: 'fixture-token' } } : { json: [] })
  const directory = await temporaryDirectory(t)
  const profile = join(directory, 'config.json')
  await writeFile(profile, JSON.stringify({ server: base, realm: 'saved', user: 'saved-user' }))
  await invokeWithEnv({ KC_CONFIG: profile, KC_AUTH_REALM: 'env-realm', KC_USER: 'env-user', KC_CLI_PASSWORD: 'fixture-password' },
    'get', 'users', '--realm', 'login', '--user', 'cli-user', '--target-realm', 'managed')
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', '/auth/realms/login/protocol/openid-connect/token'],
    ['GET', '/auth/admin/realms/managed/users'],
  ])
  const form = new URLSearchParams(requests[0].body)
  assert.equal(form.get('grant_type'), 'password')
  assert.equal(form.get('client_id'), 'admin-cli')
  assert.equal(form.get('username'), 'cli-user')
  assert.equal(form.get('password'), 'fixture-password')
  assert.equal(requests[1].authorization, 'Bearer fixture-token')
})

test('a bearer token bypasses password and malformed profile with --no-config', async t => {
  const { base, requests } = await mockServer(t, () => ({ json: [] }))
  const directory = await temporaryDirectory(t)
  const profile = join(directory, 'config.json')
  await writeFile(profile, 'broken JSON')
  const env = { KC_SERVER: base, KC_ACCESS_TOKEN: 'fixture-token', KC_CONFIG: profile, KC_USER: 'ignored-user' }
  await rejectsCli(invokeWithEnv(env, 'get', 'users'), /JSON/)
  await invokeWithEnv(env, 'get', 'users', '--no-config')
  assert.deepEqual(requests.map(({ method, url, authorization }) => [method, url, authorization]), [
    ['GET', '/auth/admin/realms/master/users', 'Bearer fixture-token'],
  ])
})

test('a missing default profile falls back to environment and a root base URL', async t => {
  const { base, requests } = await mockServer(t, () => ({ json: [] }))
  const directory = await temporaryDirectory(t)
  await invokeWithEnv({ HOME: directory, USERPROFILE: directory, KC_SERVER: new URL(base).origin,
    KC_ACCESS_TOKEN: 'fixture-token' }, 'get', 'users')
  assert.deepEqual(requests.map(request => request.url), ['/admin/realms/master/users'])
})

test('invalid configuration fails without making Admin REST calls or saving a profile', async t => {
  const { base, requests } = await mockServer(t, () => ({ status: 401 }))
  const directory = await temporaryDirectory(t)
  const profile = join(directory, 'config.json')
  for (const [args, message] of [
    [['config'], /Use config credentials/],
    [['config', 'credentials', '--no-config'], /Use --no-config/],
    [['config', 'credentials', '--server', base, '--token', 'fixture-token'], /Use --token/],
    [['get', 'users', '--no-config'], /Set --server/],
    [['get', 'users', '--no-config', '--server', base], /either --client or --token/],
    [['get', 'users', '--no-config', '--server', base, '--client', 'worker'], /Set KC_CLIENT_SECRET/],
    [['get', 'users', '--no-config', '--server', base, '--user', 'alice'], /Set KC_CLI_PASSWORD/],
  ]) {
    await rejectsCli(invokeWithEnv({ KC_CONFIG: profile }, ...args), message)
  }
  for (const server of ['not-a-url', 'ftp://example.invalid', base + '?q=value', base + '#hash', base.replace('//', '//user@')]) {
    await rejectsCli(invoke('get', 'users', '--no-config', '--token', 'fixture-token', '--server', server), /Invalid URL|HTTP\(S\) base URL/)
  }
  await rejectsCli(invokeWithEnv({ KC_CLIENT_SECRET: 'bad-secret' }, 'config', 'credentials',
    '--server', base, '--client', 'worker', '--config', profile), /HTTP 401/)
  await assert.rejects(readFile(profile), { code: 'ENOENT' })
  assert.deepEqual(requests.map(request => request.url), ['/auth/realms/master/protocol/openid-connect/token'])
})

test('unsafe endpoints, realms and malformed query pairs are rejected before transport', async t => {
  const { connection, requests } = await mockServer(t, () => ({ json: [] }))
  for (const endpoint of ['/', 'https://example.invalid/users', 'https%3A/example.invalid/users',
    'users//id', 'users/./id', 'users/%2e%2e', 'users/%2F', 'users/%5C', 'users/%3F', 'users/%23']) {
    await rejectsCli(invoke('get', endpoint, ...connection), /relative Keycloak Admin REST endpoint/)
  }
  await rejectsCli(invoke('get', 'users/%GG', ...connection), /URI malformed/)
  for (const realm of ['', '.', '..', 'bad/realm', 'bad\\realm']) {
    await rejectsCli(invoke('get', 'users', ...connection, '-r', realm), /Invalid target realm/)
  }
  for (const query of ['missing-equals', '=empty-key']) {
    await rejectsCli(invoke('get', 'users', ...connection, '-q', query), /Expected key=value/)
  }
  assert.deepEqual(requests, [])
})

test('generic resource commands accept literal and encoded colons in role names', async t => {
  const { connection, requests } = await mockServer(t, request => request.method === 'GET'
    ? { json: { name: 'team:admin' } }
    : { status: request.method === 'POST' ? 201 : 204 })
  await invoke('create', 'roles', ...connection, '-s', 'name=team:admin')
  const { stdout } = await invoke('get', 'roles/team:admin', ...connection)
  assert.deepEqual(JSON.parse(stdout), { name: 'team:admin' })
  await invoke('update', 'roles/team%3Aadmin', ...connection, '-n', '-s', 'description=Admin')
  await invoke('delete', 'roles/team:admin', ...connection)
  const collection = '/auth/admin/realms/demo/roles'
  const role = collection + '/team%3Aadmin'
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['POST', collection], ['GET', role], ['PUT', role], ['DELETE', role],
  ])
})

test('file payloads preserve arrays and reject invalid JSON and unsafe assignments', async t => {
  const { connection, requests } = await mockServer(t, () => ({ status: 204 }))
  const directory = await temporaryDirectory(t)
  const file = join(directory, 'payload.json')
  await writeFile(file, '[{"id":"one"}]')
  await invoke('update', 'users/id', ...connection, '-f', file, '-n')
  await invoke('delete', 'users/id/groups', ...connection, '-f', file)
  await rejectsCli(invoke('update', 'users/id', ...connection, '-f', file, '-s', 'name=value'), /Invalid attribute path/)
  for (const setting of ['.bad=1', 'a..b=1', '__proto__.a=1', 'a.prototype.b=1', 'a.constructor.b=1']) {
    await rejectsCli(invoke('create', 'users', ...connection, '-s', setting), /Invalid attribute path/)
  }
  await rejectsCli(invoke('create', 'users', ...connection, '-s', 'name'), /Expected key=value/)
  await rejectsCli(invoke('create', 'users', ...connection, '-s', 'a=[]', '-s', 'a.b=1'), /Attribute parent is not an object/)
  await writeFile(file, '{broken')
  await rejectsCli(invoke('create', 'users', ...connection, '-f', file), /JSON/)
  await rejectsCli(invoke('create', 'users', ...connection, '-f', file + '.missing'), /ENOENT/)
  assert.deepEqual(requests.map(({ method, body }) => [method, JSON.parse(body)]), [
    ['PUT', [{ id: 'one' }]], ['DELETE', [{ id: 'one' }]],
  ])
})

test('merge rejects non-object server state or input before PUT', async t => {
  const { connection, requests } = await mockServer(t, request => ({
    json: request.url.endsWith('/array') ? [] : {},
  }))
  await rejectsCli(invoke('update', 'users/array', ...connection, '-s', 'a=1'), /Use -n/)
  const result = invoke('update', 'users/object', ...connection, '-m', '-f', '-')
  result.child.stdin.end('null')
  await rejectsCli(result, /Use -n/)
  assert.deepEqual(requests.map(request => request.method), ['GET', 'GET'])
})

test('resource output handles plain text, JSON scalars, empty responses, and DELETE bodies', async t => {
  const { connection, requests } = await mockServer(t, request => {
    if (request.method === 'DELETE') return { json: { deleted: true, ignored: 1 } }
    if (request.url.endsWith('/serverinfo')) return { raw: 'fixture text', headers: { 'Content-Type': 'text/plain' } }
    if (request.url.endsWith('/scalar')) return { json: 42 }
    return { status: 204 }
  })
  assert.equal((await invoke('get', 'serverinfo', ...connection)).stdout, 'fixture text')
  assert.equal((await invoke('get', 'users/scalar', ...connection, '-F', 'id')).stdout, '42\n')
  assert.equal((await invoke('get', 'users/empty', ...connection)).stdout, '')
  assert.equal((await invoke('delete', 'users/id', ...connection, '-s', 'reason=fixture', '-o', '-c', '-F', 'deleted')).stdout,
    '{"deleted":true}\n')
  assert.equal((await invoke('delete', 'users/id', ...connection)).stdout, '')
  assert.equal(requests[0].url, '/auth/admin/serverinfo')
  assert.deepEqual(JSON.parse(requests.at(-2).body), { reason: 'fixture' })
})

test('create output follows same-origin Location and reports missing or unsafe write metadata', async t => {
  const { connection, requests } = await mockServer(t, request => {
    if (request.method === 'GET') return { json: { id: 'new' } }
    if (request.url.includes('mode=local')) return { status: 201, headers: { Location: '/auth/admin/realms/demo/users/new?extra=1' } }
    if (request.url.includes('mode=remote')) return { status: 201, headers: { Location: 'http://example.invalid/users/new' } }
    if (request.url.includes('mode=body')) return { status: 201, json: { id: 'embedded' } }
    return { status: 204 }
  })
  assert.deepEqual(JSON.parse((await invoke('create', 'users', ...connection, '-o', '-q', 'mode=local')).stdout), { id: 'new' })
  assert.deepEqual(JSON.parse((await invoke('create', 'users', ...connection, '-o', '-q', 'mode=body')).stdout), { id: 'embedded' })
  await rejectsCli(invoke('create', 'users', ...connection, '-i'), /Create succeeded.*resource ID/)
  for (const mode of ['missing', 'remote']) {
    await rejectsCli(invoke('create', 'users', ...connection, '-o', '-q', 'mode=' + mode), /Write succeeded.*resource URL/)
  }
  assert.deepEqual(requests.filter(request => request.method === 'GET').map(request => request.url), [
    '/auth/admin/realms/demo/users/new',
  ])
})

test('a redirect and a lost write response each produce an error without retry', async t => {
  const { connection, requests } = await mockServer(t, request => request.url.endsWith('/redirect')
    ? { status: 307, headers: { Location: '/auth/admin/realms/demo/other' } }
    : { disconnect: true })
  for (const id of ['redirect', 'disconnect']) {
    await rejectsCli(invoke('update', 'users/' + id, ...connection, '-n'), /fetch failed/)
  }
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['PUT', '/auth/admin/realms/demo/users/redirect'],
    ['PUT', '/auth/admin/realms/demo/users/disconnect'],
  ])
})

test('an unanswered write reaches the CLI request timeout without retry', { timeout: 45_000 }, async t => {
  const { connection, requests } = await mockServer(t, () => ({ hang: true }))
  await rejectsCli(invoke('update', 'users/id', ...connection, '-n'), /aborted due to timeout/)
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['PUT', '/auth/admin/realms/demo/users/id'],
  ])
})

test('an unexpected non-Error rejection is reported without exposing the rejected value', async () => {
  const preload = 'data:text/javascript,' + encodeURIComponent(
    "globalThis.fetch = async () => { throw 'unexpected fixture detail' }",
  )
  await rejectsCli(invokeWithEnv({ NODE_OPTIONS: '--import=' + preload },
    'get', 'users', '--server', 'http://127.0.0.1:1', '--token', 'fixture-token', '--no-config'), /^Unexpected error\n$/)
})

test('subgroup search reads additional legacy pages and sends native search on newer versions', async t => {
  const { base, requests } = await mockServer(t, request => {
    const url = new URL(request.url, 'http://localhost')
    return { json: url.searchParams.get('first') === '0'
      ? Array.from({ length: 100 }, (_, index) => ({ name: 'unrelated-' + index }))
      : [{ name: 'Team-platform', id: 'match' }] }
  })
  const args = ['get', 'groups/parent/children', '--server', base, '--token', 'fixture-token', '--no-config', '-r', 'demo', '-q', 'search=team']
  for (const [env, flags] of [
    [{ KC_SERVER_VERSION: '24.0.0' }, []],
    [{ KC_SERVER_VERSION: '24.0.0' }, ['--server-version', '25.0.0']],
    [{}, []],
  ]) {
    assert.deepEqual(JSON.parse((await invokeWithEnv(env, ...args, ...flags)).stdout), [{ name: 'Team-platform', id: 'match' }])
  }
  assert.deepEqual(requests.map(request => new URL(request.url, 'http://localhost').search), [
    '?first=0&max=100', '?first=100&max=100', '?search=team', '?search=team',
  ])
  for (const [flags, message] of [
    [['--server-version', 'invalid'], /Expected a Keycloak version/],
    [['--server-version', '23.0.0', '-q', 'briefRepresentation=invalid'], /briefRepresentation must/],
    [['--server-version', '24.0.0', '--offset=-1'], /nonnegative integers/],
  ]) {
    await rejectsCli(invoke(...args, ...flags), message)
  }
  assert.equal(requests.length, 4)
  await invoke('get', 'groups/parent/children', '--server', base, '--token', 'fixture-token', '--no-config',
    '-r', 'demo', '--server-version', '23.0.0')
  assert.equal(new URL(requests.at(-1).url, 'http://localhost').search, '?briefRepresentation=true')
})

test('realm role commands resolve exact usernames and select direct, effective and available views', async t => {
  const prefix = '/auth/admin/realms/demo'
  const mapping = prefix + '/users/u1/role-mappings/realm'
  const role = { id: 'r1', name: 'reader' }
  const { connection, requests } = await mockServer(t, request => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.replace(/\/$/, '') === prefix + '/users' &&
      url.searchParams.get('username') === 'alice' && url.searchParams.get('exact') === 'true') {
      return { json: [{ username: 'alice', id: 'u1' }, { username: 'alice-alt', id: 'other' }] }
    }
    if (url.pathname === prefix + '/roles/reader') return { json: role }
    if (request.method === 'GET' && [mapping, mapping + '/composite', mapping + '/available'].includes(url.pathname)) {
      return { json: [role] }
    }
    if (url.pathname === mapping && ['POST', 'DELETE'].includes(request.method)) return { status: 204 }
  })
  for (const flag of [[], ['--effective'], ['--available']]) {
    assert.deepEqual(JSON.parse((await invoke('get-roles', ...connection, '--uusername', 'alice', ...flag)).stdout), [role])
  }
  for (const command of ['add-roles', 'remove-roles']) {
    await invoke(command, ...connection, '--uid', 'u1', '--rolename', 'reader')
  }
  assert.deepEqual(requests.filter(request => request.url.startsWith(mapping))
    .map(({ method, url, body }) => [method, url, body && JSON.parse(body)]), [
    ['GET', mapping, ''], ['GET', mapping + '/composite', ''], ['GET', mapping + '/available', ''],
    ['POST', mapping, [role]], ['DELETE', mapping, [role]],
  ])
})

test('role validation rejects conflicting selectors and unresolved resources without a mapping write', async t => {
  const prefix = '/auth/admin/realms/demo'
  const { connection, requests } = await mockServer(t, request => {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.replace(/\/$/, '') === prefix + '/users') {
      const user = url.searchParams.get('username')
      if (user === 'duplicate') return { json: [{ username: user, id: '1' }, { username: user, id: '2' }] }
      if (user === 'no-id') return { json: [{ username: user }] }
      return { json: [] }
    }
    if (url.pathname.replace(/\/$/, '') === prefix + '/clients') {
      return { json: [{ clientId: 'no-id' }] }
    }
  })
  for (const [command, args, message] of [
    ['get-roles', [], /exactly one/],
    ['get-roles', ['--uid', '1', '--uusername', 'alice'], /exactly one/],
    ['get-roles', ['--uid', '1', '--cid', '1', '--cclientid', 'example'], /at most one.*--cid/],
    ['get-roles', ['--uid', '1', '--effective', '--available'], /at most one.*--effective/],
    ['add-roles', ['--uid', '1'], /at least one --rolename/],
    ['get-roles', ['unexpected'], /named options only/],
  ]) {
    await rejectsCli(invoke(command, ...connection, ...args), message)
  }
  assert.deepEqual(requests, [])
  for (const [args, message] of [
    [['--uusername', 'missing'], /matching user, found 0/],
    [['--uusername', 'duplicate'], /matching user, found 2/],
    [['--uusername', 'no-id'], /did not return a resource ID/],
    [['--uid', '1', '--cclientid', 'missing'], /matching client, found 0/],
    [['--uid', '1', '--cclientid', 'no-id'], /did not return a resource ID/],
  ]) {
    await rejectsCli(invoke('get-roles', ...connection, ...args), message)
  }
  await rejectsCli(invoke('add-roles', ...connection, '--uid', '1', '--rolename', 'missing'), /Role not found|HTTP 404/)
  assert.equal(requests.length, 6)
  assert.ok(requests.every(request => request.method === 'GET' && !request.url.includes('role-mappings')))
})

test('a failed profile rename removes its temporary file', async t => {
  const { base } = await mockServer(t, () => ({ json: { access_token: 'fixture-token' } }))
  const directory = await temporaryDirectory(t)
  const profile = join(directory, 'profile')
  await mkdir(profile)
  await rejectsCli(invokeWithEnv({ KC_CLI_CLIENT_SECRET: 'fixture-secret' },
    'config', 'credentials', '--server', base, '--client', 'worker', '--config', profile), /EISDIR|ENOTDIR|EEXIST/)
  assert.deepEqual(await readdir(directory), ['profile'])
})

test('empty or malformed readback and non-JSON payloads are handled without extra writes', async t => {
  const { connection, requests } = await mockServer(t, request => {
    if (request.method === 'PUT') return { status: 204 }
    if (request.url.endsWith('/malformed')) return { raw: '{broken', headers: { 'Content-Type': 'application/json' } }
    return { status: 204 }
  })
  const empty = await invoke('update', 'users/empty', ...connection, '-n', '-o')
  assert.equal(empty.stdout, '')
  await rejectsCli(invoke('update', 'users/malformed', ...connection, '-n', '-o'), /Write succeeded but readback failed/)
  const malformed = invoke('create', 'users', ...connection, '-f', '-')
  malformed.child.stdin.end('{broken')
  await rejectsCli(malformed, /JSON/)
  assert.deepEqual(requests.map(request => request.method), ['PUT', 'GET', 'PUT', 'GET'])
})
