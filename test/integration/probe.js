import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Kc from '@keycloak/keycloak-admin-client'

const [baseUrl, version] = process.argv.slice(2)
const realmName = 'sdk-compat'
const clientId = 'sdk-probe'
const clientSecret = process.env.PROBE_SECRET
const admin = new Kc({ baseUrl, realmName: 'master' })
const kc = new Kc({ baseUrl, realmName })
const { users, clients, roles, groups } = kc
const results = {}
async function check(name, fn) {
  try {
    await fn()
    results[name] = { pass: true }
    return true
  } catch (error) {
    results[name] = { pass: false, assertion: error.code === 'ERR_ASSERTION', status: error.response?.status, message: error.message }
    return false
  }
}
const skipped = name => { results[name] = { skipped: true } }
let user, client, realmRole, clientRole, group, other, child
const auth = { grantType: 'client_credentials', clientId, clientSecret }
const boot = await check('bootstrap', async () => {
  await admin.auth({
    grantType: 'password', clientId: 'admin-cli', username: 'probe-admin',
    password: process.env.PROBE_PASSWORD,
  })
  const info = await admin.serverInfo.find()
  assert.equal(info.systemInfo.version, version)
  await admin.realms.create({ realm: realmName, enabled: true })
  const service = await admin.clients.create({
    realm: realmName, clientId, secret: clientSecret, publicClient: false,
    serviceAccountsEnabled: true, enabled: true, protocol: 'openid-connect',
  })
  const account = await admin.clients.getServiceAccountUser({ realm: realmName, id: service.id })
  const [management] = await admin.clients.find({ realm: realmName, clientId: 'realm-management' })
  const role = await admin.clients.findRole({
    realm: realmName, id: management.id, roleName: 'realm-admin',
  })
  await admin.users.addClientRoleMappings({
    realm: realmName, id: account.id, clientUniqueId: management.id, roles: [role],
  })
})
if (boot) {
  const authenticated = await check('auth.client_credentials', async () => {
    await kc.auth(auth)
    assert.ok(await kc.getAccessToken())
    assert.equal((await clients.find({ clientId }))[0].clientId, clientId)
  })
  await check('auth.invalid_secret', async () => {
    const invalid = new Kc({ baseUrl, realmName })
    await assert.rejects(invalid.auth({ ...auth, clientSecret: 'invalid' }), e => e.response?.status === 401)
  })
  if (authenticated) {
    await check('users.create', async () => {
      user = await users.create({ username: 'matrix-user', enabled: true })
      assert.ok(user.id)
    })
    if (user?.id) {
      await check('users.read', async () => {
        assert.equal((await users.findOne(user)).username, 'matrix-user')
        assert.equal((await users.find({ username: 'matrix-user', exact: true }))[0].id, user.id)
      })
      await check('users.update', async () => {
        await users.update(user, { firstName: 'Updated' })
        const current = await users.findOne(user)
        assert.equal(current.firstName, 'Updated')
        assert.equal(current.username, 'matrix-user')
      })
      await check('users.update_undeclared_attribute', async () => {
        await users.update(user, { attributes: { sample: ['yes'] } })
        assert.deepEqual((await users.findOne(user)).attributes?.sample, ['yes'])
      })
      if (version !== '23.0.0') await check('users.update_declared_attribute', async () => {
        const profile = await users.getProfile()
        await users.updateProfile({
          ...profile, attributes: [...profile.attributes, {
            name: 'sample', permissions: { view: ['admin'], edit: ['admin'] },
          }],
        })
        await users.update(user, { attributes: { sample: ['yes'] } })
        assert.deepEqual((await users.findOne(user)).attributes?.sample, ['yes'])
      })
    }
    await check('clients.create', async () => {
      client = await clients.create({
        clientId: 'matrix-client', enabled: true, protocol: 'openid-connect',
        publicClient: true, redirectUris: ['https://example.invalid/old'],
      })
      assert.ok(client.id)
    })
    if (client?.id) {
      await check('clients.read', async () => {
        assert.equal((await clients.findOne(client)).clientId, 'matrix-client')
        assert.equal((await clients.find({ clientId: 'matrix-client' }))[0].id, client.id)
      })
      await check('clients.update', async () => {
        const current = await clients.findOne(client)
        const redirectUris = ['https://example.invalid/new']
        await clients.update(client, { ...current, redirectUris })
        assert.deepEqual((await clients.findOne(client)).redirectUris, redirectUris)
      })
    }
    if (user?.id) {
      const mapping = await check('roles.realm.add', async () => {
        await roles.create({ name: 'matrix-realm-role' })
        realmRole = await roles.findOneByName({ name: 'matrix-realm-role' })
        await users.addRealmRoleMappings({ ...user, roles: [realmRole] })
        assert.ok((await users.listRealmRoleMappings(user)).some(r => r.id === realmRole.id))
      })
      if (mapping) await check('roles.realm.remove', async () => {
        await users.delRealmRoleMappings({ ...user, roles: [realmRole] })
        assert.ok(!(await users.listRealmRoleMappings(user)).some(r => r.id === realmRole.id))
      })
      else skipped('roles.realm.remove')
    }
    if (user?.id && client?.id) {
      const target = { ...user, clientUniqueId: client.id }
      const mapping = await check('roles.client.add', async () => {
        await clients.createRole({ id: client.id, name: 'matrix-client-role' })
        clientRole = await clients.findRole({ id: client.id, roleName: 'matrix-client-role' })
        await users.addClientRoleMappings({ ...target, roles: [clientRole] })
        assert.ok((await users.listClientRoleMappings(target)).some(r => r.id === clientRole.id))
      })
      if (mapping) await check('roles.client.remove', async () => {
        await users.delClientRoleMappings({ ...target, roles: [clientRole] })
        assert.ok(!(await users.listClientRoleMappings(target)).some(r => r.id === clientRole.id))
      })
      else skipped('roles.client.remove')
    }
    await check('groups.create', async () => {
      group = await groups.create({ name: 'matrix-parent' })
      other = await groups.create({ name: 'matrix-other' })
      assert.ok(group.id && other.id)
    })
    if (group?.id) {
      await check('groups.read', async () => {
        assert.equal((await groups.findOne(group)).name, 'matrix-parent')
        assert.ok((await groups.find({ search: 'matrix-parent' })).some(g => g.id === group.id))
      })
      await check('groups.update', async () => {
        await groups.update(group, { name: 'matrix-renamed' })
        assert.equal((await groups.findOne(group)).name, 'matrix-renamed')
      })
      if (user?.id) {
        await check('groups.membership.add', async () => {
          await users.addToGroup({ ...user, groupId: group.id })
          assert.ok((await groups.listMembers(group)).some(u => u.id === user.id))
          assert.ok((await users.listGroups(user)).some(g => g.id === group.id))
        })
        await check('groups.membership.remove', async () => {
          await users.delFromGroup({ ...user, groupId: group.id })
          assert.ok(!(await groups.listMembers(group)).some(u => u.id === user.id))
        })
      }
      await check('groups.child.create', async () => {
        child = await groups.createChildGroup(group, {
          name: 'matrix-child', attributes: { marker: ['present'] },
        })
        assert.equal((await groups.findOne(child)).path, '/matrix-renamed/matrix-child')
      })
      if (child?.id) {
        await check('groups.child.list', async () => {
          assert.ok((await groups.listSubGroups({ parentId: group.id, max: 10 })).some(g => g.id === child.id))
        })
        const children = briefRepresentation => groups.listSubGroups({
          parentId: group.id, max: 10, briefRepresentation,
        })
        await check('groups.child.list_full', async () => {
          const entry = (await children(false)).find(g => g.id === child.id)
          assert.deepEqual(entry?.attributes?.marker, ['present'])
        })
        await check('groups.child.list_brief', async () => {
          const entry = (await children(true)).find(g => g.id === child.id)
          assert.ok(entry)
          assert.equal(entry.attributes?.marker, undefined)
        })
        await check('groups.child.search', async () => {
          const found = await groups.listSubGroups({
            parentId: group.id, search: 'matrix-child', max: 10,
          })
          assert.ok(found.some(g => g.id === child.id))
          const unmatched = await groups.listSubGroups({
            parentId: group.id, search: 'no-such-child', max: 10,
          })
          assert.deepEqual(unmatched.map(g => g.name), [])
        })
        if (version === '23.0.0') await check('groups.child.invert_brief_flag', async () => {
          const full = (await children(true)).find(g => g.id === child.id)
          const brief = (await children(false)).find(g => g.id === child.id)
          assert.deepEqual(full?.attributes?.marker, ['present'])
          assert.ok(brief)
          assert.equal(brief.attributes?.marker, undefined)
        })
        if (['23.0.0', '24.0.0'].includes(version)) {
          await check('groups.child.search_locally', async () => {
            const results = []
            for (let first = 0; ; first += 10) {
              const page = await groups.listSubGroups({ parentId: group.id, first, max: 10 })
              results.push(...page)
              if (page.length < 10) break
            }
            assert.deepEqual(results.filter(g => g.name.includes('matrix-child')).map(g => g.id), [child.id])
            assert.deepEqual(results.filter(g => g.name.includes('no-such-child')), [])
          })
        }
        if (['25.0.0', '26.0.0'].includes(version)) {
          const query = { parentId: group.id, search: 'matrix-child', exact: true }
          await groups.createChildGroup(group, { name: 'matrix-child-alt' })
          await check('groups.child.search_exact_sdk', async () => {
            assert.deepEqual((await groups.listSubGroups(query)).map(g => g.name), ['matrix-child'])
          })
          await check('groups.child.search_exact_rest', async () => {
            const endpoint = new URL(
              '/admin/realms/' + realmName + '/groups/' + group.id + '/children', baseUrl,
            )
            endpoint.search = new URLSearchParams({ search: query.search, exact: 'true' })
            const response = await fetch(endpoint, {
              headers: { Authorization: 'Bearer ' + await kc.getAccessToken() },
            })
            assert.equal(response.status, 200)
            assert.deepEqual((await response.json()).map(g => g.name), ['matrix-child'])
          })
        }
        await check('groups.child.read_full', async () => {
          assert.deepEqual((await groups.findOne(child)).attributes.marker, ['present'])
        })
        if (other?.id) await check('groups.child.move', async () => {
          await groups.updateChildGroup(other, { id: child.id, name: 'matrix-child' })
          assert.equal((await groups.findOne(child)).path, '/matrix-other/matrix-child')
        })
        await check('groups.child.delete', async () => {
          await groups.del(child)
          assert.equal(await groups.findOne(child), null)
        })
      }
      await check('groups.delete', async () => {
        await groups.del(group)
        assert.equal(await groups.findOne(group), null)
      })
    }
    if (user?.id) await check('users.delete', async () => {
      await users.del(user)
      assert.equal(await users.findOne(user), null)
    })
    if (client?.id) await check('clients.delete', async () => {
      await clients.del(client)
      assert.equal(await clients.findOne(client), null)
    })
  }
}
if (results['auth.client_credentials']?.pass) {
  const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
  const config = process.env.PROBE_CONFIG
  const env = {
    PATH: process.env.PATH, KC_SERVER: baseUrl, KC_AUTH_REALM: realmName,
    KC_CLIENT_ID: clientId, KC_CLIENT_SECRET: clientSecret, KC_CONFIG: config,
  }
  function cli(...args) {
    return execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env }).trim()
  }
  const get = (...args) => JSON.parse(cli('get', ...args))
  await check('cli.config', () => {
    cli('config', 'credentials', '--server', baseUrl, '--realm', realmName, '--client', clientId)
    const saved = readFileSync(config, 'utf8')
    assert.ok(!saved.includes(clientSecret))
    assert.equal(JSON.parse(saved).realm, realmName)
    assert.ok(execFileSync(process.execPath, [cliPath, 'get', 'clients', '-q', 'clientId=' + clientId], {
      encoding: 'utf8', env: { PATH: process.env.PATH, KC_CONFIG: config, KC_CLIENT_SECRET: clientSecret },
    }).includes(clientId))
  })
  await check('cli.auth.reject_bad_secret', () => {
    assert.throws(() => cli('get', 'users', '--secret', 'invalid'), error =>
      error.status === 1 && error.stderr.includes('401') && !error.stdout)
  })
  let userId, clientUniqueId, parent, childId
  const readyUser = await check('cli.users.crud', () => {
    userId = cli('create', 'users', '-r', realmName, '-s', 'username=cli-matrix', '-s', 'enabled=true', '-i')
    assert.deepEqual(get('users', '-q', 'username=cli-matrix', '--fields', 'id,username'), [
      { id: userId, username: 'cli-matrix' },
    ])
    execFileSync(process.execPath, [cliPath, 'update', 'users/' + userId, '-f', '-', '-m', '-s', 'lastName=Matrix'], {
      encoding: 'utf8', env, input: JSON.stringify({ firstName: 'Updated' }),
    })
    assert.deepEqual(get('users/' + userId, '--fields', 'username,firstName,lastName'), {
      username: 'cli-matrix', firstName: 'Updated', lastName: 'Matrix',
    })
  })
  const readyClient = await check('cli.clients.crud', () => {
    clientUniqueId = cli('create', 'clients', '-s', 'clientId=cli-matrix', '-s', 'protocol=openid-connect',
      '-s', 'publicClient=true', '-s', 'redirectUris=["https://example.invalid/old"]', '-i')
    assert.equal(get('clients', '-q', 'clientId=cli-matrix')[0].id, clientUniqueId)
    cli('update', 'clients/' + clientUniqueId, '-s', 'redirectUris=["https://example.invalid/new"]')
    const current = get('clients/' + clientUniqueId)
    assert.equal(current.clientId, 'cli-matrix')
    assert.deepEqual(current.redirectUris, ['https://example.invalid/new'])
  })
  if (readyClient) await check('cli.kcadm_parity', async () => {
    const token = await kc.getAccessToken()
    function kcadm(...args) {
      const result = spawnSync(process.env.PROBE_KCADM, [
        ...args, '--no-config', '--server', baseUrl, '--realm', realmName, '--token', token,
      ], { encoding: 'utf8', env: { PATH: process.env.PATH, JAVA_HOME: process.env.JAVA_HOME } })
      assert.equal(result.status, 0, 'Official kcadm ' + args[0] + ' failed')
      return result.stdout.trim()
    }
    const endpoint = 'clients/' + clientUniqueId
    const fields = ['-F', 'id,clientId,enabled']
    assert.deepEqual(get(endpoint, ...fields), JSON.parse(kcadm('get', endpoint, ...fields)))
    const official = JSON.parse(kcadm('update', endpoint, '-s', 'enabled=false', '-o', ...fields))
    const local = JSON.parse(cli('update', endpoint, '-s', 'enabled=false', '-o', ...fields))
    assert.deepEqual(local, official)
    assert.equal(local.enabled, false)
  })
  if (readyUser && readyClient) await check('cli.roles', () => {
    cli('create', 'clients/' + clientUniqueId + '/roles', '-s', 'name=cli-client-role')
    for (const [role, clientArgs] of [
      ['matrix-realm-role', []],
      ['cli-client-role', ['--cclientid', 'cli-matrix']],
    ]) {
      const target = ['--uusername', 'cli-matrix', ...clientArgs]
      const names = (...args) => JSON.parse(cli('get-roles', ...args)).map(r => r.name)
      assert.ok(names(...target, '--available').includes(role))
      cli('add-roles', ...target, '--rolename', role)
      assert.ok(names(...target).includes(role))
      assert.ok(names(...target, '--effective').includes(role))
      cli('remove-roles', ...target, '--rolename', role)
      assert.ok(!names(...target).includes(role))
    }
  })
  await check('cli.groups', () => {
    parent = cli('create', 'groups', '-s', 'name=cli-parent', '-i')
    cli('update', 'groups/' + parent, '-s', 'name=cli-renamed')
    childId = cli('create', 'groups/' + parent + '/children', '-s', 'name=cli-child',
      '-s', 'attributes.marker=["present"]', '-i')
    const endpoint = 'groups/' + parent + '/children'
    const versionFlag = ['--server-version', version]
    const [full] = get(endpoint, ...versionFlag, '-q', 'briefRepresentation=false', '-q', 'search=cli-child')
    assert.deepEqual(full.attributes.marker, ['present'])
    assert.equal(get(endpoint, ...versionFlag, '-q', 'briefRepresentation=true')[0].attributes?.marker, undefined)
    assert.deepEqual(get(endpoint, ...versionFlag, '-q', 'search=does-not-exist'), [])
    if (readyUser) {
      cli('update', 'users/' + userId + '/groups/' + childId, '-n')
      assert.ok(get('groups/' + childId + '/members').some(member => member.id === userId))
      cli('delete', 'users/' + userId + '/groups/' + childId)
      assert.ok(!get('groups/' + childId + '/members').some(member => member.id === userId))
    }
    cli('delete', 'groups/' + parent)
    assert.ok(!get('groups', '-q', 'search=cli-renamed').some(group => group.id === parent))
  })
  if (userId) await check('cli.users.delete', () => {
    cli('delete', 'users/' + userId)
    assert.deepEqual(get('users', '-q', 'username=cli-matrix', '-q', 'exact=true'), [])
  })
  if (clientUniqueId) await check('cli.clients.delete', () => {
    cli('delete', 'clients/' + clientUniqueId)
    assert.deepEqual(get('clients', '-q', 'clientId=cli-matrix'), [])
  })
}
console.log(JSON.stringify({ version, results }, null, 2))
const expectedDifferences = new Set([
  ...(version === '23.0.0' ? ['groups.child.list_full', 'groups.child.list_brief'] : []),
  ...(['23.0.0', '24.0.0'].includes(version) ? ['groups.child.search'] : []),
  ...(version !== '23.0.0' ? ['users.update_undeclared_attribute'] : []),
])
for (const [name, result] of Object.entries(results)) {
  if (expectedDifferences.has(name)) {
    if (result.pass || !result.assertion) process.exitCode = 1
  } else if (!result.pass) process.exitCode = 1
}
if (results['cli.clients.delete']?.pass !== true || results['cli.roles']?.pass !== true || results['cli.kcadm_parity']?.pass !== true) process.exitCode = 1
