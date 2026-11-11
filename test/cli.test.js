import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const invoke = (...args) => exec(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH } })

test('help and argument errors work before making a connection', async () => {
  assert.match((await invoke('--help')).stdout, /config credentials/)
  for (const args of [
    ['get', 'users', '--unknown'],
    ['get', 'users', '--fields', 'attributes(*)'],
    ['update', 'users/id', '-m', '-n'],
  ]) {
    await assert.rejects(invoke(...args), error => error.code === 1 && error.stderr.length > 0)
  }
})

test('update merges dotted fields by default and honors a file without GET', async t => {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() })
    if (request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401).end()
    } else if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ attributes: { old: ['keep'], sample: ['old'] } }))
    } else {
      response.writeHead(204).end()
    }
  })
  t.after(() => server.close())
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/auth'
  const connection = ['--server', base, '--token', 'test-token', '--no-config', '-r', 'demo']
  await invoke('update', 'users/id', ...connection, '-s', 'attributes.sample=["new"]')
  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ['GET', '/auth/admin/realms/demo/users/id'],
    ['PUT', '/auth/admin/realms/demo/users/id'],
  ])
  assert.deepEqual(JSON.parse(requests[1].body), { attributes: { old: ['keep'], sample: ['new'] } })
  requests.length = 0

  const child = execFile(process.execPath, [cli, 'update', 'users/id', ...connection, '-f', '-'])
  child.stdin.end('{"enabled":false}')
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  assert.deepEqual(requests.map(({ method, body }) => [method, JSON.parse(body)]), [['PUT', { enabled: false }]])
  requests.length = 0
  await assert.rejects(invoke('get', 'users/../clients', ...connection), /relative Keycloak Admin REST endpoint/)
  assert.equal(requests.length, 0)
})
