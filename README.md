# Live Idol Timetable（服务器同步版）

React/Vite 前端与 Node API 组成的演出活动网站。`/` 展示今日、明日、即将到来和历史活动；`/events/:id` 复用原有 Now Playing、Next Up、Timetable、Delay 与海报 crop 功能；`/admin` 管理活动。

## 本地开发

Node.js 22+，执行 `npm install`。先设置环境变量，再分别启动 API 和 Vite：

```powershell
$env:ADMIN_ACCESS_KEY = "仅用于本地开发的密钥"
$env:ADMIN_SESSION_SECRET = "至少32字符的本地开发随机会话密钥"
$env:DATA_DIR = "./server-data"
npm run dev:server
```

另开终端执行 `npm run dev`。`npm run build` 构建 `dist/` 和 `dist-server/`；`npm test` 运行校验、时间分类、迁移与 API 鉴权测试。当前没有 lint 脚本。

## 数据与管理

OCR 协议仍为 [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) 的 `schema_version: "1.0"`。网站层 `ActivityRecord` 将 `id`、`city`、`posterUrl`、时间戳与原有 `EventData` 包装在一起；城市没有写入 OCR JSON。服务器使用现有 Node 服务和原子写入的 `DATA_DIR/activities.json` 持久化活动，原始海报单独保存在 `DATA_DIR/posters/`，不放入 JSON。首次启动会从旧 `state.json` 迁入原共享活动，并保留该文件及旧团体缩略图。

普通用户可读取 `GET /api/activities`、`GET /api/activities/:id` 和 `GET /api/activities/:id/poster`。管理操作使用 `POST /api/admin/login`、`GET /api/admin/session`、`POST /api/admin/logout`、`POST /api/admin/activities`、`PATCH /api/admin/activities/:id`、`DELETE /api/admin/activities/:id`。所有管理写请求均由服务器验证 HttpOnly 签名会话；密钥不写入前端或 localStorage。浏览器对每场活动使用独立的 `live-idol-delay:<id>`，不会改动服务器活动 JSON。

## 阿里云部署

独立 Nginx 监听 `9999`，Node API 仅监听本机 `127.0.0.1:10001`。部署文件位于 `deploy/`。前端由 `/opt/live-idol-timetable/current` 提供，API 从 `/opt/live-idol-timetable/api-current/server/main.js` 启动，数据位于 `/var/lib/live-idol-timetable/`。`/etc/live-idol-timetable-api.env` 至少设置：

```ini
ADMIN_ACCESS_KEY=请使用长随机密钥
ADMIN_SESSION_SECRET=请使用独立的至少32字符随机密钥
```

`ADMIN_ACCESS_KEY` 可沿用旧版管理员密钥，以便管理员用原密钥登录；旧 `WRITE_TOKEN` 不再使用。生产部署需让环境文件仅 root 可读，并对数据目录保持服务用户可写。当前服务器通过 HTTP IP 访问；在可信域名和 HTTPS 配置完成前，管理密钥与会话传输不受 TLS 保护。HTTPS 下 API 会给会话 Cookie 添加 `Secure`。
