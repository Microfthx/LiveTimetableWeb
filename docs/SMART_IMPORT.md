# 管理员智能导入

智能导入在现有 `/admin`「导入新活动」弹层中运行。手动上传海报、粘贴 OCR JSON、复制 OCR Prompt、原有预览及活动 CRUD 继续可用。

## 流程

1. 选择「从微博获取」或「本地上传图片」。微博模式需要单条博文 HTTPS 链接和当前有效的 Cookie Header；只读取该博文，不扫描账号、评论或时间线。正文可直接作为时间表来源。
2. 为图片选择「时间表」「团体图」「活动封面」角色。同一图片可担任多个角色。没有时间表图片时，只要正文非空即可启动 AI；没有团体图时，默认用时间表图片；没有任何图片时，所有 crop 为 0，封面显示占位图。
3. 点击「AI 识别 Timetable」才发起一次 OpenRouter Chat Completions API 请求。时间表图片与团体图若相同只发送一次，若不同则在一次请求中分别标记 IMAGE A/B。若正文与管理员指定的时间表图片冲突，以图片为准；没有时间表图片则正文为主要时间来源。单独的活动封面作为 IMAGE C 提供城市、活动标题和场地线索，不用于时间表或 crop。若未指定封面但还有未使用的微博图片，第一张作为城市参考图；它不会自动成为活动封面。
4. AI 在同一次 Structured Output 中输出 EventData v1.0 字段和顶层城市元数据 `city`。城市只从图片或正文中的明确地点识别，无法确认时留空。后端把 `city` 与 EventData 分离，把 `delay_minutes` 强制设为 0，并以团体图真实像素尺寸覆盖 `poster.width/height`。结果仅进入待检查草稿，不自动创建活动；AI 响应返回后立即预填现有城市输入框，管理员手动填写的城市不会被覆盖。
5. 管理员在可视化编辑或 JSON 编辑中修正活动、团名、时间和 crop；可增删团体。非法 JSON 仅留在独立文本草稿，不覆盖上一个合法数据。点击「应用修改并生成导入预览」后排序并重新编号，复用现有裁剪、Overlay 和导入预览。最终确认才调用原有 `POST /api/admin/activities`。

## 微博凭据与素材

微博 Cookie 通过 `POST /api/admin/weibo/parse` 发送给后端。管理员勾选「在此浏览器记住 Cookie」后，才会保存在当前站点的 `localStorage`；取消勾选或点击「清除已保存的 Cookie」会移除它。未勾选时，获取完成后清空输入。Cookie 不进入 ActivityRecord、服务器日志或 Git；服务器不持久化 Cookie。浏览器扩展、同源脚本和能使用该浏览器的人可能读取本地保存的 Cookie，因此公用设备上不应勾选。支持标准 `key=value; key=value`，值中包含 `=` 也能解析。

链接只接受 `weibo.com`、`www.weibo.com`、`m.weibo.cn`、`weibo.cn` 的 HTTPS 单条博文；后端从链接提取博文 ID 后请求固定微博详情接口。微博图片只接受 `sinaimg.cn` 的 HTTPS 图片地址。每次重定向都重新检查目标域名，阻止访问本机或任意第三方地址。微博登录失效或人工验证时返回明确错误；不绕过验证。

解析成功生成 `importId`。图片提取兼容 `pics` 与 `pic_ids` / `pic_infos`；移动端详情没有图片地址时，再检查同一博文的桌面端详情。单张图片的高清地址失败时尝试其他尺寸地址。目标博文的多张图片按原顺序暂存于 `DATA_DIR/tmp/weibo-import/<importId>/`，每张实际校验格式、宽高和 20 MB 大小。管理员通过需登录的 `/api/admin/weibo/import-assets/<importId>/<imageId>` 预览。失败的单张图片给出警告，其他图片继续使用。超过 24 小时的临时目录在后续导入请求及定时清理时删除；正式活动只保存需要的图片。

## 资产与兼容

`ActivityRecord.posterUrl` 是活动列表封面；`cropSourceUrl` 是团体裁剪原图。两者相同则服务器只存一个文件；不同则分别存入 `DATA_DIR/posters/`。进入活动详情时仅从 `cropSourceUrl` 生成团体图；旧活动没有独立裁剪源时回退到原 `posterUrl`。`EventData` 仍只包含 schema_version、event、delay_minutes、poster、groups；顶层 `city` 是导入元数据，保存到 `ActivityRecord.city`，素材角色不进入 OCR 协议。JSON 存储文件 `activities.json` 的新增图片字段为可选，旧记录无需重新导入。

## 服务器配置

在 API 服务的私有环境文件中设置 `OPENROUTER_API_KEY`、`OPENROUTER_OCR_MODEL`、`OPENROUTER_OCR_MODEL_HIGH`；普通识别使用 `z-ai/glm-5.3-flash`，高精度识别使用 `qwen/qwen3.8-27b`。不要使用 `VITE_` 前缀或提交真实值。模型须支持图像理解与 JSON Schema Structured Outputs。没有 Key 时微博读取和手动 JSON 仍可用，AI 按钮提示未配置。服务器需安装 `image-size` 生产依赖，`/api/` 的请求体上限为 80 MB。所有微博与 AI 接口都沿用管理员 HttpOnly session、写请求来源校验和基础限流。OpenRouter 单独计费，不使用 ChatGPT Plus 订阅额度。

较长的图片时间表可能在 HTTP 200 响应头到达后仍持续生成响应体。API 为整次 OpenRouter 请求保留 240 秒，9999 端口 Nginx 的 `/api/` 读取超时设为 270 秒；响应体在读取阶段超时会明确报告 AI 超时。人工复制的 OCR Prompt 则优先要求聊天模型生成可下载的 `.json` 文件；自动导入仍读取 OpenRouter JSON API 响应，不依赖附件。

当前微博获取基于单条博文的移动端详情接口；微博若改变接口或要求额外验证，界面会提示失败，管理员可以使用本地图片或手动 JSON 继续。OpenRouter 调用只在管理员点击按钮时发生，失败不清空素材、角色、城市或草稿。
