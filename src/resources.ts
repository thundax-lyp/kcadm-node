import { readFile } from 'node:fs/promises'
import { stdin } from 'node:process'
import type KeycloakAdminClient from '@keycloak/keycloak-admin-client'

type JsonObject = Record<string, unknown>
export type ResourceCommand = 'get' | 'create' | 'update' | 'delete'

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pair(input: string) {
  const separator = input.indexOf('=')
  if (separator < 1) throw new Error('Expected key=value')
  return [input.slice(0, separator), input.slice(separator + 1)] as const
}

function attributeValue(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

async function readBody(file: string | undefined): Promise<unknown> {
  let result: unknown = {}
  if (file) {
    if (file === '-') {
      const chunks: Buffer[] = []
      for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } else {
      result = JSON.parse(await readFile(file, 'utf8'))
    }
  }
  return result
}

function applySettings(result: unknown, settings: string[]) {
  for (const setting of settings) {
    const [key, value] = pair(setting)
    const segments = key.split('.')
    if (!isObject(result) || segments.some(s => !s || ['__proto__', 'prototype', 'constructor'].includes(s))) {
      throw new Error('Invalid attribute path')
    }
    let target = result
    for (const segment of segments.slice(0, -1)) {
      const existing = target[segment]
      if (existing !== undefined && !isObject(existing)) throw new Error('Attribute parent is not an object')
      const next = existing ?? {}
      target[segment] = next
      target = next as JsonObject
    }
    target[segments.at(-1)!] = attributeValue(value)
  }
  return result
}

function endpointUrl(base: string, endpoint: string, realm: string, query: string[]) {
  const url = new URL(base)
  const segments = endpoint.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent)
  if (segments.some(part => !part || /[\\/?#]/.test(part) || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Use a relative Keycloak Admin REST endpoint')
  }
  const [root] = segments
  if (!realm || ['.', '..'].includes(realm) || /[\\/]/.test(realm)) throw new Error('Invalid target realm')
  const prefix = root === 'realms' || root === 'serverinfo' ? '/admin' : '/admin/realms/' + encodeURIComponent(realm)
  url.pathname += (url.pathname.endsWith('/') ? prefix.slice(1) : prefix) + '/' + segments.map(encodeURIComponent).join('/')
  for (const value of query) url.searchParams.append(...pair(value))
  return { url, segments }
}

async function request(kc: KeycloakAdminClient, url: URL, method: string, payload?: unknown) {
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: 'Bearer ' + await kc.getAccessToken(),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Keycloak ${method} ${url.pathname} returned HTTP ${response.status}`)
  }
  return response
}

function printJson(data: unknown, fields?: string, compressed?: boolean) {
  const select = (entry: unknown) => fields && isObject(entry)
    ? Object.fromEntries(fields.split(',').filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]))
    : entry
  console.log(JSON.stringify(Array.isArray(data) ? data.map(select) : select(data), null, compressed ? undefined : 2))
}

async function printResponse(response: Response, options: ResourceOptions) {
  const value = await response.text()
  if (!value) return
  if (!response.headers.get('content-type')?.includes('json') && !options.fields) {
    process.stdout.write(value)
    return
  }
  printJson(JSON.parse(value), options.fields, options.compressed)
}

async function listChildren(kc: KeycloakAdminClient, url: URL, version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error('Expected a Keycloak version such as 23.0.0')
  const [, major, minor, patch] = match.map(Number)
  const query = url.searchParams
  if (major === 23 && minor === 0 && patch < 4) {
    const brief = query.get('briefRepresentation') ?? 'false'
    if (brief !== 'true' && brief !== 'false') throw new Error('briefRepresentation must be true or false')
    query.set('briefRepresentation', String(brief === 'false'))
  }
  const search = query.get('search')
  if (major >= 25 || !search) return (await request(kc, url, 'GET')).json()
  const first = Number(query.get('first') ?? 0)
  const max = Number(query.get('max') ?? 10)
  if (![first, max].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('first and max must be nonnegative integers for legacy subgroup search')
  }
  const exact = query.get('exact') === 'true'
  query.delete('search')
  query.delete('exact')
  const results: JsonObject[] = []
  const pageSize = 100
  const needle = search.toLowerCase()
  for (let offset = 0; results.length < first + max; offset += pageSize) {
    query.set('first', String(offset))
    query.set('max', String(pageSize))
    const page: JsonObject[] = await (await request(kc, url, 'GET')).json()
    for (const group of page) {
      const name = String(group.name).toLowerCase()
      if (exact ? name === needle : name.includes(needle)) results.push(group)
    }
    if (page.length < pageSize) break
  }
  return results.slice(first, first + max)
}

export type ResourceOptions = {
  query?: string[]
  set?: string[]
  file?: string
  fields?: string
  output?: boolean
  id?: boolean
  'no-merge'?: boolean
  merge?: boolean
  compressed?: boolean
  offset?: string
  limit?: string
  'server-version'?: string
}

export async function resources(kc: KeycloakAdminClient, realm: string, command: ResourceCommand, endpoint: string, options: ResourceOptions) {
  const { url, segments } = endpointUrl(kc.baseUrl, endpoint, realm, options.query ?? [])
  if (command === 'get') {
    if (options.offset !== undefined) url.searchParams.set('first', options.offset)
    if (options.limit !== undefined) url.searchParams.set('max', options.limit)
    const version = options['server-version'] ?? process.env.KC_SERVER_VERSION
    if (version && segments.length === 3 && segments[0] === 'groups' && segments[2] === 'children') {
      printJson(await listChildren(kc, url, version), options.fields, options.compressed)
    } else {
      await printResponse(await request(kc, url, 'GET'), options)
    }
    return
  }
  if (command === 'delete') {
    const payload = options.file || options.set?.length
      ? applySettings(await readBody(options.file), options.set ?? [])
      : undefined
    const response = await request(kc, url, 'DELETE', payload)
    if (options.output) await printResponse(response, options)
    else await response.body?.cancel()
    return
  }

  const settings = options.set ?? []
  let payload = await readBody(options.file)
  if (command === 'update' && !options['no-merge'] && (options.merge || (!options.file && settings.length > 0))) {
    const current: unknown = await (await request(kc, url, 'GET')).json()
    if (!isObject(current) || !isObject(payload)) throw new Error('Use -n to update a non-object resource')
    // A file supplies top-level replacements. Dotted -s paths retain sibling properties.
    payload = { ...current, ...payload }
  }
  payload = applySettings(payload, settings)
  const response = await request(kc, url, command === 'create' ? 'POST' : 'PUT', payload)
  if (options.id) {
    const location = response.headers.get('location')
    const id = location && new URL(location, url).pathname.split('/').filter(Boolean).at(-1)
    if (!id) throw new Error('Create succeeded but Keycloak did not return a resource ID')
    console.log(decodeURIComponent(id))
  }
  if (options.output) {
    const location = response.headers.get('location')
    if (response.status === 204 || (command === 'create' && location && !response.headers.get('content-type'))) {
      await response.body?.cancel()
      const resource = command === 'update' ? new URL(url) : location ? new URL(location, url) : undefined
      if (!resource || resource.origin !== url.origin) {
        throw new Error('Write succeeded but the resource URL could not be read back')
      }
      resource.search = ''
      try {
        await printResponse(await request(kc, resource, 'GET'), options)
      } catch (error) {
        throw new Error(`Write succeeded but readback failed: ${(error as Error).message}`)
      }
    } else {
      await printResponse(response, options)
    }
  } else await response.body?.cancel()
}
