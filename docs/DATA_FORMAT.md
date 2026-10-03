# OCR JSON 数据协议（唯一规范）

本文件定义海报 OCR 输出、网页导入和后端接口使用的 **schema_version 1.0**。`EventData` 结构保持 1.0；OCR 可以附带顶层 `city` 作为导入元数据，导入时提取到 `ActivityRecord.city`，不会写入 `EventData` 或 `event`。所有时间均为活动地点的当地时间；协议不包含时区。

## 完整示例

```json
{
  "schema_version": "1.0",
  "city": "厦门",
  "event": {
    "title": "7.in XIAMEN Vol.7.0",
    "date": "2026-10-01",
    "venue": "Efive-BOX",
    "doors_time": "13:45",
    "start_time": "14:00"
  },
  "delay_minutes": 0,
  "poster": { "width": 1080, "height": 1528 },
  "groups": [
    {
      "id": "group_001",
      "name": "FZI*TWO",
      "start_time": "14:00",
      "end_time": "14:10",
      "benefit_type": "normal",
      "benefit_time_start": "14:20",
      "benefit_time_end": "15:00",
      "crop": { "x": 0.13, "y": 0.37, "width": 0.2, "height": 0.11 }
    }
  ]
}
```

## 字段与约束

| 路径 | 类型 | 规则 |
| --- | --- | --- |
| `schema_version` | string | 必填，当前仅接受 `"1.0"`。 |
| `city` | string | OCR 导入元数据，可选；应根据海报明确的城市、地址或标题识别，无法确定时留空。管理员保存活动前仍须填写城市。后端把它保存在 `ActivityRecord.city`，不放入 `EventData.event`。 |
| `event.title` | string | 必填，非空。 |
| `event.date` | string | 必填，真实日历日期；规范格式 `YYYY-MM-DD`。海报只有月、日而没有年份时，OCR 使用当前年份；网页导入还兼容 `M月D日`、`M-D`、`M/D` 等缺少年份的月日写法，并补当前年。只有月份而没有日时不可猜测，需人工补齐。 |
| `event.venue` | string | 可选，地点；缺失时界面显示“演出现场”。 |
| `event.doors_time` | string | 可选，`HH:mm`，24 小时制。 |
| `event.start_time` | string | 可选，`HH:mm`；强烈建议 OCR 提供，它也是跨午夜排程的日期锚点。 |
| `delay_minutes` | integer | 可选，缺失视为 0；可正可负，范围 -1440 到 1440。 |
| `poster.width`, `poster.height` | nonnegative integer | OCR 输出必填；读取不到原图尺寸时两者都为 0。旧版手工 JSON 可省略 `poster`。若有尺寸，仅比较与上传海报的宽高比，误差超过 5% 警告但不阻止。 |
| `groups` | array | 必填，至少一组。导入时按演出开始时刻稳定排序。 |
| `groups[].id` | string | 必填，非空且在活动内唯一。 |
| `groups[].name` | string | 必填，非空。 |
| `groups[].start_time` | string | 必填，`HH:mm` 或 `""`（OCR 无法确定）；始终表示**原始**时间。空时间放在时间轴末尾并提示核对。 |
| `groups[].end_time` | string | 必填，`HH:mm` 或 `""`；时长确定时必须大于 0 且不超过 12 小时。 |
| `groups[].benefit_type` | `normal` \| `final` \| `none` | OCR 输出必填；旧活动可省略，按 `none` 显示。`normal` 表示有明确的普通特典时间，`final` 表示只标注“终特”，`none` 表示没有可靠特典信息。 |
| `groups[].benefit_time_start`, `groups[].benefit_time_end` | string | OCR 输出必填，分别为 `HH:mm` 或 `""`。`normal` 时从来源提取明确时间，不得从演出时间推断；`final` / `none` 时写空字符串。旧活动可省略。单侧缺失只提示核对，不影响演出时间。 |
| `groups[].image_base64` | string | 可选，缺失等同 `""`。只放纯 Base64，不放 `data:` 前缀。空值显示占位图。 |
| `groups[].image_mime` | string | 可选，默认 `image/jpeg`；支持 `image/jpeg`、`image/png`、`image/webp`、`image/gif`。 |
| `groups[].crop` | object | OCR 输出必填；旧版手工 JSON 可省略。`x`,`y`,`width`,`height` 是相对于**原始上传海报的 naturalWidth / naturalHeight** 的 0–1 坐标。四项全为 0 表示无法确定，显示占位图；有效矩形的宽高必须大于 0 且不可越界。 |

固定 OCR Prompt 的输出**只有**示例所示字段：不输出 `image_base64` / `image_mime`。顶层 `city` 只供管理导入表单使用，服务器保存的 `EventData` 仍只有 `schema_version`、`event`、`delay_minutes`、`poster`、`groups`。网页从用户上传的同一张海报，按归一化 crop 生成临时 Blob 图片 URL，按 `group.id` 绑定到当前活动。为兼容第一阶段数据，手工 JSON 和本地已存活动仍可带 `image_base64` / `image_mime`。不认识的额外字段导入时忽略。OCR 无法确认活动名、具体日期或团体时间时留空；网页会拒绝缺失活动名或日期的数据，团体时间缺失则在预览提示并允许导入。网页可接受 ChatGPT 包在 ` ```json ... ``` ` 中的合法 JSON，也会将 JSON 语法允许范围之外的常见 Unicode 缩进空白转换为空格；不会自动修复缺逗号等语法错误。

## 时间语义

- `start_time` / `end_time` 永远是海报上的原始排程，**不能因现场延迟而改写**。
- 特典时间是独立的原始时段，不从演出时间推断；`delay_minutes` 仅调整演出时段，特典时间保持其明确标注的钟点。`benefit_status` 是网页根据当前时刻计算的 `upcoming` / `ongoing` / `ended` / `none`，不写入 OCR JSON 或数据库。列表只有一个主状态：普通特典进行中显示“特典中”，结束后显示“特典结束”；其余按演出进度显示 `UPCOMING`、`NEXT`、“演出中”或“演出结束”。
- 实际显示和状态判断使用 `effective_time = original_time + delay_minutes`。当前演出、下一组、进度、倒计时均依此计算。
- 时间区间左闭右开：`effectiveStart <= now < effectiveEnd` 为 `LIVE`；结束时刻开始为 `FINISHED`。
- 跨午夜时，以 `event.date + event.start_time` 为锚点。比活动开始钟点早的团体时间视为次日；例如活动 23:00 开始、团体 00:05 开始表示次日 00:05。`end_time` 早于 `start_time` 表示该组跨午夜；相等则无效。省略 `event.start_time` 时以当日 00:00 为锚点，因此跨午夜活动必须提供它。
- 若单组 `end_time` 早于 `start_time`，网页按跨午夜解析，并在导入确认前提示人工核对。
- 排程空档没有 `LIVE` 团体；界面显示 `INTERMISSION`。演出前显示首组，结束后保留完整时间表。

## OCR Prompt 必须遵守的输出约定

1. 仅输出符合上述结构的 JSON 对象；`schema_version` 固定 `"1.0"`。
2. 按海报原始时间逐组提取，不叠加现场延迟。未知延迟写 0。
3. 时间统一转成两位小时和分钟（如 `09:05`）；活动日期写 `YYYY-MM-DD`，只有月、日时采用当前年份，只有月份时留空待核对。
4. `id` 从 `group_001` 按演出时间连续编号；无法识别的字段留空，不编造。
5. `delay_minutes` 固定为 0；`poster` 放真实输入图片像素尺寸，不知道时宽高都写 0。
6. 每组必须带 `crop`；无法确定时四项全写 0。OCR 不输出图片 Base64，由网页裁剪。
7. 每组输出 `benefit_type` 和两个特典时间字段：明确的普通特典时段用 `normal` + 起止时间，只有“终特”用 `final` + 两个空字符串，无可靠信息用 `none` + 两个空字符串。不要推测特典时段，也不要把特典会识别为演出团体。

完整 Prompt 的唯一文本位于仓库根目录 `json生成prompt.txt`，`src/constants/ocrPrompt.ts` 在运行时填入当前年份。更改 Prompt、网页或后端之前，先更新此协议。

## 导入与存储

智能导入可以使用管理员指定的时间表图片、微博正文，或两者交叉核对。`timetableSource`、`cropSource`、`displayPoster` 都是导入草稿的素材角色，**不加入 EventData v1.0**。若只提供微博正文，`poster` 宽高为 0，所有 `crop` 为全 0。若提供裁剪源，`poster.width/height` 由程序读取该图片实际像素尺寸并覆盖 AI 输出；所有团体的 crop 坐标只相对于这张图片。活动列表封面属于 `ActivityRecord.posterUrl`，可以和 `cropSourceUrl` 不同；旧活动只保存一张海报时，裁剪源回退到 `posterUrl`。

网页解析时校验字段、时间、重复 ID、海报尺寸、图片类型和裁剪范围；严重 JSON/关键字段错误不会覆盖现有活动，单个 crop 无效会提示并降级为全 0。无海报仍可导入，图片回退至已有 `image_base64` 或占位图。服务器保存活动 `EventData`、城市、海报和裁剪原图。浏览器在活动详情中按需从裁剪原图生成团体图片；首页不裁剪团体图片。访客调整的演出延迟按活动 ID 保存在该浏览器的 localStorage，不修改服务器原始数据。

## 网站层活动与团体库

本节是网站数据模型，**不属于 OCR JSON v1.0**。OCR Prompt 和 `EventData` 不增加团体库 ID、微博 UID、头像 URL 或城市字段。

`ActivityRecord` 在 `EventData` 外层保存 `id`、`city`、`data`、海报 URL、创建/更新时间和可选的 `groupBindings: Record<string, string>`。绑定的键是本场 `data.groups[].id`，值是团体库的永久 UUID。旧活动没有 `groupBindings` 时仍按原有 crop / 图片 / 占位图显示；不会强制迁移或改写 OCR 内容。

团体库记录 `GroupLibraryRecord` 保存独立 UUID、标准团体名、可选微博 UID/主页/头像来源、本站头像 URL 和创建/更新时间。服务器将库元数据保存在 `groups.json`，将头像压缩为最长边不超过 512 像素的 WebP 文件保存在 `groups/<UUID>/`。活动元数据继续保存在 `activities.json`；活动海报保存在 `posters/`。以上均位于服务器配置的数据目录，不写入浏览器 localStorage。

导入时仅对标准团体名做 NFC Unicode 规范化与首尾空白去除，然后**精确且区分大小写**匹配。不会自动把别名、局部相似名称或 AI 猜测名称绑定。管理员在预览中可解除或手动改变绑定。团体库没有头像时继续使用本场 crop。图片统一优先级：已绑定团体库头像 → 本场运行时 crop → `image_base64` 旧图片 → 占位图。已绑定且有头像的团体跳过 Canvas crop；未匹配团体可在预览中用核对过的 crop 图加入团体库。删除被活动绑定的团体会被服务器拒绝，须先解除引用。

公开读取接口：`GET /api/activities`、`GET /api/activities/:id`、`GET /api/groups`、`GET /api/groups/:id/avatar`。所有写操作都在 `/api/admin/` 下，并需要服务器验证的管理员 Session，包括新增/修改/删除团体和活动。微博主页导入接口只返回可编辑预览，不自动保存；微博头像经服务器下载和处理后，在管理员明确保存时才写入团体库。微博 Cookie 仅随本次请求使用，可由管理员选择在当前浏览器保存，不存入 `groups.json`。
