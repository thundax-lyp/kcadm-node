import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('./', import.meta.url))
const host = '127.0.0.1'
const cancellation = new AbortController()
const stop = () => cancellation.abort(new Error('Matrix interrupted'))

async function port() {
  const listener = createServer().listen(0, host)
  await once(listener, 'listening')
  const { port } = listener.address() as AddressInfo
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()))
  return port
}

async function terminate(pid: number | undefined, exited: Promise<unknown>) {
  if (!pid) return
  const group = -pid
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(group, name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  signal('SIGTERM')
  if (await Promise.race([exited.then(() => false), delay(15_000, true, { ref: false })])) {
    signal('SIGKILL')
    await exited
  }
}

async function waitForServer(baseUrl: string, log: string, ended: () => boolean) {
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    cancellation.signal.throwIfAborted()
    if (ended()) throw new Error('Server exited before readiness. See ' + log)
    if ((await readFile(log, 'utf8')).includes('Running the server in development mode')) {
      const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(2_000)])
      const response = await fetch(baseUrl + '/realms/master/.well-known/openid-configuration', { signal })
        .catch(() => undefined)
      await response?.body?.cancel()
      if (response?.status === 200) return
    }
    await delay(1_000, undefined, { signal: cancellation.signal })
  }
  throw new Error('Server readiness timeout. See ' + log)
}

async function run(version: string, source: string, output: string) {
  const workspace = await mkdtemp(join(tmpdir(), 'kcadm-node-'))
  try {
    const server = join(workspace, 'keycloak')
    await cp(join(source, 'keycloak-' + version), server, {
      recursive: true, dereference: true, filter: path => basename(path) !== 'data',
    })
    cancellation.signal.throwIfAborted()
    const httpPort = await port()
    const baseUrl = 'http://' + host + ':' + httpPort
    const password = randomBytes(16).toString('hex')
    const env: NodeJS.ProcessEnv = { ...process.env, JAVA_OPTS_KC_HEAP: '-Xms128m -Xmx768m' }
    const legacy = version.startsWith('23.') || version.startsWith('24.')
    if (legacy && process.env.KC_MATRIX_JAVA17) env.JAVA_HOME = process.env.KC_MATRIX_JAVA17
    if (version.startsWith('26.')) {
      Object.assign(env, { KC_BOOTSTRAP_ADMIN_USERNAME: 'probe-admin', KC_BOOTSTRAP_ADMIN_PASSWORD: password })
    } else {
      Object.assign(env, { KEYCLOAK_ADMIN: 'probe-admin', KEYCLOAK_ADMIN_PASSWORD: password })
    }
    const args = ['start-dev', '--http-host=' + host, '--http-port=' + httpPort]
    if (!legacy) args.push('--http-management-port=' + await port())
    const log = join(output, version + '.log')
    const stream = await open(log, 'w', 0o600)
    try {
      const child = spawn(join(server, 'bin/kc.sh'), args, {
        cwd: server, env, detached: true, stdio: ['ignore', stream.fd, stream.fd],
      })
      let ended = false
      const exited = new Promise<void>(done => {
        const finish = () => { ended = true; done() }
        child.once('error', finish)
        child.once('exit', finish)
      })
      try {
        await waitForServer(baseUrl, log, () => ended)
        const outcome = await exec(process.execPath, [join(root, 'probe.js'), baseUrl, version], {
          signal: cancellation.signal, timeout: 180_000,
          env: {
            ...process.env, JAVA_HOME: env.JAVA_HOME,
            PROBE_PASSWORD: password, PROBE_SECRET: randomBytes(24).toString('hex'),
            PROBE_CONFIG: join(workspace, 'config.json'), PROBE_KCADM: join(server, 'bin/kcadm.sh'),
          },
        }).then(result => ({ ...result, code: 0 }), error => {
          if (typeof error.code !== 'number' || error.killed) throw error
          return { stdout: String(error.stdout), stderr: String(error.stderr), code: error.code }
        })
        await writeFile(join(output, version + '.json'), outcome.stdout, { mode: 0o600 })
        if (outcome.stderr) await writeFile(join(output, version + '.stderr'), outcome.stderr, { mode: 0o600 })
        const { results } = JSON.parse(outcome.stdout) as { results: Record<string, { pass?: boolean }> }
        const entries = Object.entries(results)
        const differences = entries.filter(([, result]) => !result.pass).map(([name]) => name)
        console.log(`${version}: ${entries.length - differences.length}/${entries.length}; raw differences: ${differences.join(', ') || 'none'}; exit=${outcome.code}`)
        return outcome.code === 0
      } finally {
        await terminate(child.pid, exited)
      }
    } finally {
      await stream.close()
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

async function main() {
  const supported = (await readFile(join(root, 'versions.txt'), 'utf8')).trim().split(/\s+/)
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { servers: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  })
  if (values.help) {
    console.log(`Usage: npm run test:matrix -- [--servers DIR] [--output DIR] [${supported.join(' | ')} ...]`)
    return
  }
  const source = values.servers ?? process.env.KC_MATRIX_SERVERS
  if (!source) throw new Error('Specify --servers or KC_MATRIX_SERVERS with extracted Keycloak distributions')
  const versions = positionals.length ? [...new Set(positionals)] : supported
  for (const version of versions) {
    if (!supported.includes(version)) throw new Error('Unsupported Keycloak version: ' + version)
  }
  const output = resolve(values.output ?? join(root, 'results'))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const results = await Promise.allSettled(versions.map(version => run(version, resolve(source), output)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.error(`${versions[index]}: ${String(result.reason)}`)
    if (result.status === 'rejected' || !result.value) process.exitCode = 1
  })
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
}
