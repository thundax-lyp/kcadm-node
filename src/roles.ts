import type KeycloakAdminClient from '@keycloak/keycloak-admin-client'

export type RoleCommand = 'get-roles' | 'add-roles' | 'remove-roles'
export type RoleOptions = {
  uid?: string
  uusername?: string
  cid?: string
  cclientid?: string
  rolename?: string[]
  effective?: boolean
  available?: boolean
}

function one<T>(matches: T[], kind: string): T {
  if (matches.length !== 1) throw new Error(`Expected one matching ${kind}, found ${matches.length}`)
  return matches[0]
}

export async function roles(kc: KeycloakAdminClient, realm: string, command: RoleCommand, options: RoleOptions) {
  const { uid, uusername, cid, cclientid, rolename, effective, available } = options
  if (Boolean(uid) === Boolean(uusername)) throw new Error('Specify exactly one of --uid and --uusername')
  if (cid && cclientid) throw new Error('Specify at most one of --cid and --cclientid')
  if (effective && available) throw new Error('Specify at most one of --effective and --available')
  if (command !== 'get-roles' && !rolename?.length) throw new Error('Specify at least one --rolename')

  const id = uid ?? one(
    (await kc.users.find({ realm, username: uusername, exact: true })).filter(user => user.username === uusername),
    'user',
  ).id
  const clientUniqueId = cid ?? (cclientid ? one(
    (await kc.clients.find({ realm, clientId: cclientid })).filter(client => client.clientId === cclientid),
    'client',
  ).id : undefined)
  if (!id || (cclientid && !clientUniqueId)) throw new Error('Keycloak did not return a resource ID')

  const target = { id, realm }
  const clientTarget = clientUniqueId ? { ...target, clientUniqueId } : undefined
  const { users } = kc
  if (command === 'get-roles') {
    const result = clientTarget
      ? await (effective ? users.listCompositeClientRoleMappings
        : available ? users.listAvailableClientRoleMappings : users.listClientRoleMappings)(clientTarget)
      : await (effective ? users.listCompositeRealmRoleMappings
        : available ? users.listAvailableRealmRoleMappings : users.listRealmRoleMappings)(target)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const mappings = await Promise.all([...new Set(rolename)].map(async name => {
    const role = clientUniqueId
      ? await kc.clients.findRole({ realm, id: clientUniqueId, roleName: name })
      : await kc.roles.findOneByName({ realm, name })
    if (!role?.id || !role.name) throw new Error(`Role not found: ${name}`)
    return { id: role.id, name: role.name }
  }))
  const add = command === 'add-roles'
  if (clientTarget) {
    await (add ? users.addClientRoleMappings : users.delClientRoleMappings)({ ...clientTarget, roles: mappings })
  } else {
    await (add ? users.addRealmRoleMappings : users.delRealmRoleMappings)({ ...target, roles: mappings })
  }
}
