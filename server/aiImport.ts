import type { EventData } from "../src/types/timetable.js";
import type { AiCropDebugData } from "../src/types/aiCropDebug.js";
import { sanitizeJsonInput, validateEventDataDetailed } from "../src/utils/validation.js";
import { createHash } from "node:crypto";

export interface AiImage {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
}

export class AiImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface AiUpstreamResponse {
  status: number;
  contentType: string | null;
  requestId: string | null;
  body: string;
  complete: boolean;
}

const cropSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
  required: ["x", "y", "width", "height"],
} as const;

/** Wire format follows docs/DATA_FORMAT.md; website metadata never enters this schema. */
export const EVENT_DATA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schema_version: { type: "string", enum: ["1.0"] },
    event: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        date: { type: "string" },
        venue: { type: "string" },
        doors_time: { type: "string" },
        start_time: { type: "string" },
      },
      required: ["title", "date", "venue", "doors_time", "start_time"],
    },
    delay_minutes: { type: "integer" },
    poster: {
      type: "object",
      additionalProperties: false,
      properties: { width: { type: "integer" }, height: { type: "integer" } },
      required: ["width", "height"],
    },
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
          benefit_type: { type: "string", enum: ["normal", "final", "none"] },
          benefit_time_start: { type: "string" },
          benefit_time_end: { type: "string" },
          crop: cropSchema,
        },
        required: ["id", "name", "start_time", "end_time", "benefit_type", "benefit_time_start", "benefit_time_end", "crop"],
      },
    },
  },
  required: ["schema_version", "event", "delay_minutes", "poster", "groups"],
} as const;

/** City is import metadata, not part of EventData v1.0. */
export const AI_IMPORT_SCHEMA = {
  ...EVENT_DATA_SCHEMA,
  properties: {
    ...EVENT_DATA_SCHEMA.properties,
    city: { type: "string" },
  },
  required: [...EVENT_DATA_SCHEMA.required, "city"],
} as const;

export function aiInputParts(
  timetable: AiImage | null,
  crop: AiImage | null,
  postText: string,
  cover: AiImage | null = null,
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];
  const image = (value: AiImage) => ({
    type: "image_url" as const,
    image_url: { url: `data:${value.mime};base64,${value.bytes.toString("base64")}` },
  });
  if (timetable && crop && timetable === crop) {
    content.push(
      {
        type: "text",
        text: "IMAGE A 同时是 TIMETABLE SOURCE 和 GROUP VISUAL / CROP SOURCE。时间与裁剪都从这张图读取。",
      },
      image(timetable),
    );
  } else {
    if (timetable)
      content.push(
        {
          type: "text",
          text: "IMAGE A = TIMETABLE SOURCE。优先从此图读取活动时间、OPEN、START、演出顺序及每组时间。",
        },
        image(timetable),
      );
    if (crop)
      content.push(
        {
          type: "text",
          text: "IMAGE B = GROUP VISUAL / CROP SOURCE。所有 groups[].crop 必须相对这张图的完整画布；根据团体名或 Logo 匹配，不能按图片顺序猜测。",
        },
        image(crop),
      );
  }
  if (cover && cover !== timetable && cover !== crop)
    content.push(
      {
        type: "text",
        text: "IMAGE C = ACTIVITY POSTER / CITY CONTEXT。读取活动标题、城市、地址等明确的活动信息；不要从此图改写管理员指定的时间表，也不要相对此图计算 groups[].crop。",
      },
      image(cover),
    );
  if (postText.trim())
    content.push({
      type: "text",
      text: `微博正文（${timetable ? "用于交叉核对；若与管理员指定的时间表图冲突，以图为准" : "主要 TIMETABLE SOURCE；从正文读取演出顺序和时间"}）：\n${postText.slice(0, 20000)}`,
    });
  return content;
}

const instruction = `你是 Live Idol 演出时间表结构化识别器。只提取提供的单场活动信息，输出 EventData v1.0。
若有管理员指定的 TIMETABLE SOURCE 图片，以该图的演出时间为准，微博正文用于交叉核对；若无时间表图，以微博正文为主要时间来源。Crop Source 上可能出现的时间优先级最低。单独的 ACTIVITY POSTER / CITY CONTEXT 图片只供识别活动信息与城市，不作为时间表或裁剪坐标来源。
识别活动名称、日期、场地、OPEN、START、全部实际出演团体和每组 start_time/end_time；不要把 OPEN、START、特典会、物贩、交流会、票价、主办方或工作人员当团体。时间用 HH:mm。某团有明确开始时间但没有结束时间、且下一团开始时间明确时，可以将下一团开始时间填为本团结束时间；已有结束时间不覆盖，最后一团或顺序不明时留空。不要推断特典时间。只出现月日时使用当前年份 ${new Date().getFullYear()}。
为每个出演团体另外提取特典：明确的普通特典起止时间填写 benefit_type="normal"、benefit_time_start/end 为 HH:mm；只写“终特”则 benefit_type="final"、两个时间均为空字符串；没有可靠特典信息则 benefit_type="none"、两个时间均为空字符串。不要从演出时段推测特典时间，不要把特典时段当作演出时段。若普通特典仅识别到一侧时间，保留已知一侧，另一侧留空供管理员核对。
groups 按开始时间排列，id 从 group_001 连续编号。delay_minutes 固定 0。
所有 crop 仅相对于 GROUP VISUAL / CROP SOURCE，以 0 到 1 归一化坐标表示；找不到对应视觉时四项全 0。若完全没有 Crop Source，所有 crop 四项全 0。不要按 Timetable 图片计算 crop，除非它同时就是 Crop Source。
根据所有已提供图片及微博正文中的活动标题、场地或地址明确识别活动所在城市，输出顶层 city 字符串。活动封面明确写出城市时必须提取，例如写了“西安”就填“西安”；微博正文明确写出城市时也必须提取，不要求图片再次标注。不要根据团名推测城市；若来源冲突，以管理员指定的时间表图为准；无法可靠确定时 city 填空字符串。city 不属于 event。
poster 宽高由程序覆盖，输出时可填 0。只输出 schema_version、event、delay_minutes、poster、groups、city；不要输出微博信息、解释或推理。`;

const AI_REQUEST_TIMEOUT_MS = 240_000;

export async function recognizeEvent(input: {
  timetable: AiImage | null;
  crop: AiImage | null;
  cover?: AiImage | null;
  postText: string;
  mode: "normal" | "high";
  apiKey?: string;
  normalModel?: string;
  highModel?: string;
  fetchImpl?: typeof fetch;
  debug?: boolean;
  timeoutMs?: number;
  onResponse?: (response: AiUpstreamResponse) => Promise<void>;
}): Promise<{
  data: EventData;
  city: string;
  warnings: string[];
  model: string;
  mode: "normal" | "high";
  debug?: AiCropDebugData;
}> {
  if (!input.timetable && !input.postText.trim())
    throw new AiImportError(
      "AI_SOURCE_REQUIRED",
      "请选择时间表图片，或提供包含时间表的微博正文。",
    );
  if (!input.apiKey)
    throw new AiImportError(
      "AI_NOT_CONFIGURED",
      "AI 自动识别未配置，请使用手动 JSON。",
      503,
    );
  const model = input.mode === "high" ? input.highModel : input.normalModel;
  if (!model)
    throw new AiImportError(
      "AI_NOT_CONFIGURED",
      "AI 模型未配置，请使用手动 JSON。",
      503,
    );
  const content = aiInputParts(input.timetable, input.crop, input.postText, input.cover);
  let response: Response;
  const started = Date.now();
  try {
    response = await (input.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "Live Idol Timetable",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instruction },
          { role: "user", content },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "live_idol_import_with_city_v1",
            strict: true,
            schema: AI_IMPORT_SCHEMA,
          },
        },
        provider: { require_parameters: true },
        ...(model === "z-ai/glm-5.3-flash" ? { reasoning: { effort: "low" } } : {}),
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? AI_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AiImportError(
      timeout ? "AI_TIMEOUT" : "AI_REQUEST_FAILED",
      timeout ? "AI 识别超时，请重试或使用手动 JSON。" : "无法连接 OpenRouter，请检查服务器网络或使用手动 JSON。",
      502,
    );
  }
  let responseText = "";
  const upstream = (complete: boolean): AiUpstreamResponse => ({
    status: response.status,
    contentType: response.headers.get("content-type"),
    requestId: response.headers.get("x-request-id"),
    body: responseText,
    complete,
  });
  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        responseText += decoder.decode(chunk.value, { stream: true });
      }
      responseText += decoder.decode();
    } else responseText = await response.text();
  } catch (error) {
    if (responseText && input.onResponse) {
      try { await input.onResponse(upstream(false)); }
      catch (saveError) { console.error("Partial AI response save failed", saveError); }
    }
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const code = timeout ? "AI_TIMEOUT" : "AI_INVALID_OUTPUT";
    console.warn("AI response read failed", {
      model, code, upstreamStatus: response.status,
      contentType: response.headers.get("content-type"),
      errorName: error instanceof Error ? error.name : "unknown",
      latencyMs: Date.now() - started,
    });
    throw new AiImportError(
      code,
      timeout ? "AI 识别超时，请重试或使用手动 JSON。" : "AI 返回的结果无法读取，请重试或使用手动 JSON。",
      502,
    );
  }
  await input.onResponse?.(upstream(true));
  if (!response.ok) {
    const code = response.status === 401 ? "AI_AUTH_ERROR"
      : response.status === 403 ? "AI_PROVIDER_RESTRICTED"
      : response.status === 402 ? "AI_CREDITS_REQUIRED"
      : response.status === 429 ? "AI_RATE_LIMIT"
      : response.status === 400 || response.status === 404 ? "AI_MODEL_ERROR" : "AI_REQUEST_FAILED";
    const message = code === "AI_AUTH_ERROR" ? "OpenRouter 密钥无效，请检查服务器配置。"
      : code === "AI_PROVIDER_RESTRICTED" ? "OpenRouter 拒绝访问所选模型，请检查账户或模型提供方的访问限制。"
      : code === "AI_CREDITS_REQUIRED" ? "OpenRouter 额度不足，请检查账户余额。"
      : code === "AI_RATE_LIMIT" ? "AI 请求过于频繁，请稍后再试。"
      : code === "AI_MODEL_ERROR" ? "OpenRouter 模型或请求配置有误，请检查服务器设置。"
      : "AI 识别失败，请重试或使用手动 JSON。";
    console.info("AI import", { model, success: false, code, latencyMs: Date.now() - started });
    throw new AiImportError(code, message, code === "AI_RATE_LIMIT" ? 429 : 502);
  }
  let completion: {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
    provider?: string;
  };
  try {
    completion = JSON.parse(responseText);
  } catch (error) {
    console.warn("AI response JSON invalid", { model, upstreamStatus: response.status, errorName: error instanceof Error ? error.name : "unknown", latencyMs: Date.now() - started });
    throw new AiImportError("AI_INVALID_OUTPUT", "AI 返回的结果无法读取，请重试或使用手动 JSON。", 502);
  }
  const choice = completion.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason === "length") {
    console.warn("AI incomplete completion", {
      model,
      provider: completion.provider,
      finishReason: choice?.finish_reason ?? "missing",
      contentLength: choice?.message?.content?.length ?? 0,
      outputTokens: completion.usage?.completion_tokens,
      reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens,
      latencyMs: Date.now() - started,
    });
    throw new AiImportError(
      "AI_INVALID_OUTPUT",
      choice?.finish_reason === "length"
        ? "AI 输出被截断，请尝试高精度识别或手动 JSON。"
        : "AI 未返回内容，请尝试高精度识别或手动 JSON。",
      502,
    );
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(sanitizeJsonInput(choice.message.content)) as Record<string, unknown>;
  } catch {
    throw new AiImportError(
      "AI_INVALID_OUTPUT",
      "AI 返回的 JSON 无效，请重试。",
      502,
    );
  }
  if (!raw || !Array.isArray(raw.groups) || !raw.event)
    throw new AiImportError(
      "AI_INVALID_OUTPUT",
      "AI 结果缺少活动信息，请重试。",
      502,
    );
  const city = typeof raw.city === "string" ? raw.city.trim().slice(0, 80) : "";
  const eventData = { ...raw };
  delete eventData.city;
  const candidate = {
    ...eventData,
    schema_version: "1.0",
    delay_minutes: 0,
    poster: { width: input.crop?.width ?? 0, height: input.crop?.height ?? 0 },
    groups: raw.groups.map((item) => {
      const group = item as Record<string, unknown>;
      return {
        ...group,
        image_base64: "",
        image_mime: "image/jpeg",
        crop: input.crop ? group.crop : { x: 0, y: 0, width: 0, height: 0 },
      };
    }),
  };
  const warnings: string[] = [];
  let data: EventData;
  try {
    const checked = validateEventDataDetailed(candidate);
    data = checked.data;
    warnings.push(...checked.warnings);
  } catch (error) {
    data = candidate as EventData; // The pending editor can repair a semantically incomplete AI draft.
    warnings.push(
      error instanceof Error ? error.message : "AI 结果需要人工核对。",
    );
  }
  console.info("AI import", {
    model,
    provider: completion.provider,
    success: true,
    latencyMs: Date.now() - started,
    groups: data.groups.length,
    inputTokens: completion.usage?.prompt_tokens,
    outputTokens: completion.usage?.completion_tokens,
    reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens,
  });
  const debug: AiCropDebugData | undefined = input.debug ? {
    groups: raw.groups.map((item) => {
      const group = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: typeof group.id === "string" ? group.id : "",
        name: typeof group.name === "string" ? group.name : "",
        rawCrop: group.crop ?? null,
      };
    }),
    aiInput: {
      dataUrl: input.crop ? `data:${input.crop.mime};base64,${input.crop.bytes.toString("base64")}` : null,
      width: input.crop?.width ?? 0,
      height: input.crop?.height ?? 0,
      mime: input.crop?.mime ?? null,
      sha256: input.crop ? createHash("sha256").update(input.crop.bytes).digest("hex") : null,
      resize: false,
      aspectRatioPreserved: true,
      padding: false,
      centerCrop: false,
      objectFitOrCssCrop: false,
    },
  } : undefined;
  return { data, city, warnings, model, mode: input.mode, ...(debug ? { debug } : {}) };
}
