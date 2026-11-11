# kcadm-node

[English](README.md)

用于管理 Keycloak 的 TypeScript CLI，提供 kcadm 风格的命令。

## 快速开始

需要 Node.js 22 或更高版本。

`26.8.2-rc.1` 发布到 npm 后，可以全局安装或直接运行。

```sh
npm install --global kcadm-node@26.8.2-rc.1
kcadm-node --help
```

```sh
npx --yes kcadm-node@26.8.2-rc.1 --help
```

使用服务账号认证时，设置 `KC_SERVER`、`KC_AUTH_REALM`、`KC_CLIENT_ID` 和 `KC_CLIENT_SECRET`。如果客户端允许密码认证，可以使用 `KC_USER` 和 `KC_CLI_PASSWORD`。已有 Bearer 令牌时，设置 `KC_ACCESS_TOKEN`。

```sh
kcadm-node get users -r demo -q username=alice -q exact=true -F id,username
kcadm-node get-roles -r demo --uusername alice --cclientid example
```

`config credentials` 会验证连接，并保存服务器地址、认证 Realm、客户端 ID 和可选的用户名。用 `--config` 或 `KC_CONFIG` 指定配置文件路径。每次运行命令时，CLI 都会用提供的凭据获取令牌，或直接使用显式提供的访问令牌。配置文件只保存连接信息。

## 连接选项

| 选项 | 环境变量 | 用途 |
| --- | --- | --- |
| `--server URL` | `KC_SERVER` | Keycloak 基础 URL，包含部署路径前缀，例如 `/auth`。 |
| `--realm REALM` | `KC_AUTH_REALM` | 用于认证的 Realm，默认为 `master`。 |
| `-r`、`--target-realm REALM` | | 要管理的 Realm，默认与认证 Realm 相同。对 Realm 内的资源执行写操作时，请显式指定。 |
| `--client ID` | `KC_CLIENT_ID` | 用于认证的客户端 ID。使用用户名登录时默认为 `admin-cli`。 |
| `--user NAME` | `KC_USER` | 密码授权使用的用户名。 |
| `--password PASSWORD` | `KC_CLI_PASSWORD` | 密码授权使用的密码。 |
| `--secret SECRET` | `KC_CLIENT_SECRET`，备用 `KC_CLI_CLIENT_SECRET` | 客户端密钥。 |
| `--token TOKEN` | `KC_ACCESS_TOKEN` | 管理命令使用的现有 Bearer 令牌，优先于凭据认证。 |
| `--config FILE` | `KC_CONFIG` | 配置文件路径，默认为 `~/.config/kcadm-node/config.json`。 |
| `--no-config` | | 执行管理命令时跳过已保存的配置文件。 |

命令行选项优先于环境变量，环境变量优先于配置文件。请通过环境变量提供密码、密钥和令牌。未提供 Bearer 令牌时，已配置用户名则使用密码授权，否则使用客户端凭据授权。

## 资源命令

从 `kcadm-node get|create|update|delete ENDPOINT [options]` 中选择一个子命令。像 `users/ID` 这样的端点相对于 `/admin/realms/REALM/`。以 `realms` 或 `serverinfo` 开头的端点相对于 `/admin/`，例如 `realms/demo` 直接在路径中指定了 `demo`。在 `clients/ID` 路径中，请使用 Keycloak 返回的客户端内部 ID。

| 选项 | 命令 | 行为 |
| --- | --- | --- |
| `-q`、`--query KEY=VALUE` | 全部四个 | 添加查询参数，可重复使用。 |
| `-o`、`--offset OFFSET` | `get` | 设置 `first`，覆盖 `-q first=...`。 |
| `-l`、`--limit LIMIT` | `get` | 设置 `max`，覆盖 `-q max=...`。一次调用请求一页。 |
| `-F`、`--fields FIELD[,FIELD...]` | 全部四个 | 选择每个 JSON 对象的顶层字段。写操作时与 `--output` 搭配使用。 |
| `-c`、`--compressed` | 全部四个 | 输出紧凑 JSON。写操作时与 `--output` 搭配使用。 |
| `-f`、`--file FILE` | `create`、`update`、`delete` | 从文件读取 JSON。用 `-f -` 从标准输入读取。 |
| `-s`、`--set KEY=VALUE` | `create`、`update`、`delete` | 读取请求体后设置属性，可重复使用。用点号分隔的键访问嵌套对象。 |
| `-m`、`--merge` | `update` | 读取当前对象，用文件中的顶层属性覆盖对应属性，再应用 `-s` 赋值并发送结果。 |
| `-n`、`--no-merge` | `update` | 将提供的请求体与赋值结果直接通过 PUT 发送。 |
| `-i`、`--id` | `create` | 输出响应 `Location` 头中的资源 ID。与 `--output` 互斥。 |
| `-o`、`--output` | `create`、`update`、`delete` | 有响应体时输出响应体。创建和更新可再发起 GET 读取已保存的资源。 |
| `--server-version MAJOR.MINOR.PATCH` | `get` | 启用 `groups/ID/children` 的版本兼容处理，覆盖 `KC_SERVER_VERSION`。 |

未指定 `-m` 或 `-n` 时，单独使用 `-s` 会让 `update` 先读取并合并现有资源。使用 `-f` 时，默认以文件内容为请求体，再应用 `-s` 赋值。`-s` 会解析合法的 JSON 值，其余值按字符串处理。例如，`-s enabled=false` 设置布尔值，`-s 'attributes.team=["Core"]'` 设置数组。写操作默认无输出。写入可能已成功，即使随后提取 ID 或回读资源时报错。重试前请检查远端状态。

```sh
kcadm-node get users -r demo -o 0 -l 20 -F id,username
kcadm-node update "users/$USER_ID" -r demo -s 'attributes.team=["Core"]' -o
```

## 用户角色命令

| 选项 | 命令 | 行为 |
| --- | --- | --- |
| `--uid ID` 或 `--uusername NAME` | `get-roles`、`add-roles`、`remove-roles` | 按内部 ID 或精确用户名选择一个用户。 |
| `--cid ID` 或 `--cclientid CLIENT_ID` | 全部三个 | 按内部 ID 或公开客户端 ID 选择客户端。两者都省略时操作 Realm 角色。 |
| `--effective` 或 `--available` | `get-roles` | 列出生效角色（含通过复合角色获得的角色），或可分配的角色。两者都省略时列出直接分配的角色。 |
| `--rolename NAME` | `add-roles`、`remove-roles` | 至少指定一个角色名称。可重复使用，在所选范围内操作多个角色。 |

```sh
kcadm-node add-roles -r demo --uid "$USER_ID" --cclientid example --rolename reader
kcadm-node get-roles -r demo --uid "$USER_ID" --cclientid example
```

## 兼容范围

首版兼容范围之外的官方 CLI 功能包括绝对端点、CSV 和嵌套字段投影、Java 信任库选项，以及组和复合角色的快捷命令。

执行 `get groups/ID/children` 时，可通过 `--server-version` 或 `KC_SERVER_VERSION` 启用兼容处理。对 23.0.0–23.0.3 统一处理 `briefRepresentation`，对 23 和 24 在客户端执行搜索。省略版本时沿用服务端行为。补丁版本边界来自上游源码。测试矩阵选取各主版本的首个发行版。

用户属性的处理取决于 Realm 的 User Profile 配置。写入自定义属性后，请重新读取用户以确认结果。

## 本地开发

使用 Node.js 22 或更高版本。CLI 和项目工具使用 TypeScript 和 Node.js。项目禁止引入 Python 源文件和运行时依赖。

```sh
npm ci
npm test
node dist/cli.js --help
```

运行 `npm run test:coverage` 查看编译后 CLI 的行、分支和函数覆盖率。本地测试通过回环地址上的 HTTP 测试服务运行 CLI。验证实际 Keycloak 行为时，请使用下方的服务端矩阵。

npm 包版本以锁定的 `@keycloak/keycloak-admin-client` 版本为基准。每个 SDK 版本的发布候选从 `-rc.1` 开始递增。例如，`kcadm-node@26.8.2-rc.1` 使用 SDK `26.8.2`。下方列出测试矩阵涵盖的 Keycloak 服务端版本。

## 服务端兼容性测试

测试矩阵启动全新的本地 Keycloak 开发实例，覆盖 `23.0.0`、`24.0.0`、`25.0.0` 和 `26.0.0`。下载并解压相应的官方发行包，在同一目录下为每个版本保留一个 `keycloak-VERSION` 子目录。23 和 24 使用 Java 17，25 和 26 使用 Java 21。npm 脚本会构建 CLI、检查 runner 的类型，再用 Node.js 直接运行 `test/integration/run.ts`。[Keycloak 官方发行包](https://github.com/keycloak/keycloak/releases)

```sh
KC_MATRIX_SERVERS=/path/to/distributions \
KC_MATRIX_JAVA17=/path/to/java-17 \
JAVA_HOME=/path/to/java-21 \
npm run test:matrix
```

测试程序会把发行包复制到临时目录，通过回环地址启动服务器，并将 SDK 和 CLI 的测试结果记录到 `test/integration/results/`。测试要求复现已知的 SDK 原始行为差异，并验证 CLI 及其兼容处理正常工作。矩阵还会将选定的客户端查询和更新输出与各发行包自带的官方 CLI 进行比较。

仓库协作流程见 [提交规则](docs/00-governance/COMMIT-RULES.md) 和 [PR 规则](docs/00-governance/PR-RULES.md)。
