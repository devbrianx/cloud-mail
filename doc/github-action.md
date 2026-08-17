## Github Action 部署

**配置 Github 仓库**

1. Fork 或克隆仓库 [https://github.com/eoao/cloud-mail](https://github.com/eoao/cloud-mail)
2. 进入您的 GitHub 仓库设置
3. 转到 Settings → Secrets and variables → Actions → New Repository secrets
4. 添加以下 Secrets：

| Secret 名称             | 必需 | 用途                                                  |
| ----------------------- | :--: | ----------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  |  ✅  | Cloudflare API 令牌（需要 Workers 和相关资源权限）    |
| `CLOUDFLARE_ACCOUNT_ID` |  ✅  | Cloudflare 账户 ID                                    |
| `D1_DATABASE_ID`        |  ✅  | 您的 D1 数据库的 ID                                     |
| `KV_NAMESPACE_ID`       |  ✅  | 您的 KV 命名空间的 ID                                   |
| `R2_BUCKET_NAME`        |  ✅  | 您的 R2 存储桶的名称                                    |
| `DOMAIN`                |  ✅  | 您要用于邮件服务的域名（例如 `["xx.xx"]，多域名用,分隔`）        |
| `ADMIN`                 |  ✅  | 您的管理员邮箱地址（例如 `admin@example.com`）      |
| `JWT_SECRET`            |  ✅  | 用于生成和验证 JWT 的随机长字符串                     |
| `INIT_URL`              |  ❌  | （可选）部署后用于初始化数据库的 Worker URL（格式参考下述手动初始化）           |
| `OUTLOOK_CLIENT_ID`     |  ❌  | Microsoft Entra 应用注册的 Client ID，与 `OUTLOOK_CLIENT_SECRET` 同时配置以启用一键 Outlook OAuth 授权 |
| `OUTLOOK_CLIENT_SECRET` |  ❌  | Microsoft Entra 应用注册的 Client Secret，部署时写入 Worker Secret，不会暴露给浏览器 |

**Outlook 一键授权配置**

在 Microsoft Entra 中注册 Web 应用，添加重定向 URI：`https://<CUSTOM_DOMAIN>/api/oauth/outlook/callback`；未配置自定义域名时，使用部署产生的 `https://<worker>.workers.dev/api/oauth/outlook/callback`。为该应用配置 Microsoft Graph 委托权限 `User.Read` 与 `Mail.Read`；运行时会请求 `offline_access` 以获得刷新令牌。`OUTLOOK_CLIENT_ID` 和 `OUTLOOK_CLIENT_SECRET` 必须同时设置。

批量导入格式为 `邮箱----密码----client_id----refresh_token`。`client_id` 必须是签发该 `refresh_token` 的同一 Microsoft Entra 应用注册的应用程序（客户端）ID；邮箱必须就是该令牌对应的邮箱。第二个“密码”字段仅为兼容账号池导出格式而保留，导入时会被丢弃且不会保存。若此应用是机密客户端，部署时必须把 `OUTLOOK_CLIENT_ID` 配置为该完全相同的 ID，并把 `OUTLOOK_CLIENT_SECRET` 配置为该应用当前有效的客户端密码；Worker 仅在导入行的 `client_id` 与已部署的 `OUTLOOK_CLIENT_ID` 完全一致时才会发送该密钥。对应的应用注册及用户授权必须包含 Microsoft Graph 委托权限 `Mail.Read`。刷新时 Worker 先请求 `https://graph.microsoft.com/.default` 以兼容原账号池授权；仅当 Microsoft 返回 `AADSTS90023` 时，才回退为 `https://graph.microsoft.com/Mail.Read`。批量导入不调用 `GET /me`，因此不要求 `User.Read`；首次同步会使用 Graph 邮件权限访问该邮箱。

---

**获取 Cloudflare API 令牌**

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. 创建新的 API 令牌
3. 选择"编辑 Cloudflare Workers"模板，并参照下表添加相应权限
   ![dc2e1dc8dcd217644759c46c6c705de1](https://i.miji.bid/2025/07/07/dc2e1dc8dcd217644759c46c6c705de1.png)
4. 保存令牌并复制到 GitHub Secrets 中的 `CLOUDFLARE_API_TOKEN`

**获取 Cloudflare 账户 ID**
1. 账户 ID 可以在 Cloudflare 仪表盘的账户设置中找到。
2. 复制到 GitHub Secrets 中的 `CLOUDFLARE_ACCOUNT_ID`

**运行工作流**
1. 然后在Action页面手动运行工作流，后续同步上游后会自动部署到 Cloudflare Workers。如未配置 `INIT_URL`，则需要手动访问 `https://你的项目域名/api/init/你的jwt_secret` 进行数据库初始化。
2. 自动同步上游可使用bot或者手动点击Sync Upstream按钮。