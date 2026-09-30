# Live Idol Timetable

面向手机浏览器的演出时间表。首次打开显示内置 Demo；导入 OCR JSON 后，页面依据当前时间自动显示正在演出、下一组、进度和完整时间轴。现场延迟独立于原始排程保存。

## 本地运行

本项目已在 Node.js v24.14.1 下验证。

```bash
npm install
npm run dev:server
npm run dev
```

在两个终端分别运行 API 与 Vite。开发 API 默认无需密钥；要测试管理员验证，可在启动 API 前设置 `WRITE_TOKEN` 环境变量。打开 Vite 显示的本地地址。手机与电脑在同一网络时，可使用 Network 地址访问。运行 `npm test` 执行时间、JSON 与共享 API 测试，`npm run build` 生成可部署的 `dist/` 和 `dist-server/`。

## 服务器部署

阿里云服务器使用独立的 Nginx 服务监听 `9999`，Node API 只监听服务器本机 `127.0.0.1:10001`。配置位于 `deploy/nginx-9999.conf`、`deploy/live-idol-timetable.service` 和 `deploy/live-idol-timetable-api.service`。构建文件放在 `/opt/live-idol-timetable/releases/`，`current` 和 `api-current` 符号链接指向当前前端与 API 版本；共享数据和团体图片持久化在 `/var/lib/live-idol-timetable/`，不随版本切换删除。访问地址为 `http://120.24.94.69:9999/`。管理服务可使用 `systemctl status|restart live-idol-timetable` 和 `systemctl status|restart live-idol-timetable-api`。

活动、延迟和裁剪后的团体图片保存在服务器，所有浏览器自动同步。只有输入管理员密钥并通过验证的浏览器可修改；密钥保存在该浏览器的 `localStorage`，清除网站数据后需重新输入。旧版浏览器数据不会自动覆盖服务器活动，管理员可以从设置页显式发布。网页仍需用户把海报和内置 Prompt 发给 ChatGPT，再把返回的 JSON 粘贴回来；服务端不执行 OCR。服务器目前通过 HTTP IP 地址访问，管理员密钥在网络传输时不受 TLS 保护，投入不受信任网络使用前应配置 HTTPS。

## 数据协议

唯一规范是 [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)。OCR Prompt、网页校验与未来后端实现都应以它为准。网页类型见 `src/types/timetable.ts`，导入校验见 `src/utils/validation.ts`，时间与延迟计算见 `src/utils/time.ts`。

旧版图片仍可用纯 Base64 放在 `image_base64`；新 OCR 流程优先使用当前活动的服务器裁剪图。服务器保存缩略图，刷新后仍能显示；未保存原始高清海报，调整裁剪时需重新上传。Demo 未捏造团体照片。
