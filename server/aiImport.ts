import OpenAI from "openai";
import type { EventData } from "../src/types/timetable.js";
import { validateEventDataDetailed } from "../src/utils/validation.js";

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
          crop: cropSchema,
        },
        required: ["id", "name", "start_time", "end_time", "crop"],
      },
    },
  },
  required: ["schema_version", "event", "delay_minutes", "poster", "groups"],
} as const;

export function aiInputParts(
  timetable: AiImage | null,
  crop: AiImage | null,
  postText: string,
) {
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [];
  const image = (value: AiImage) => ({
    type: "input_image" as const,
    image_url: `data:${value.mime};base64,${value.bytes.toString("base64")}`,
    detail: "high" as const,
  });
  if (timetable && crop && timetable === crop) {
    content.push(
      {
        type: "input_text",
        text: "IMAGE A 同时是 TIMETABLE SOURCE 和 GROUP VISUAL / CROP SOURCE。时间与裁剪都从这张图读取。",
      },
      image(timetable),
    );
  } else {
    if (timetable)
      content.push(
        {
          type: "input_text",
          text: "IMAGE A = TIMETABLE SOURCE。优先从此图读取活动时间、OPEN、START、演出顺序及每组时间。",
        },
        image(timetable),
      );
    if (crop)
      content.push(
        {
          type: "input_text",
          text: "IMAGE B = GROUP VISUAL / CROP SOURCE。所有 groups[].crop 必须相对这张图的完整画布；根据团体名或 Logo 匹配，不能按图片顺序猜测。",
        },
        image(crop),
      );
  }
  if (postText.trim())
    content.push({
      type: "input_text",
      text: `微博正文（${timetable ? "用于交叉核对；若与管理员指定的时间表图冲突，以图为准" : "主要 TIMETABLE SOURCE；从正文读取演出顺序和时间"}）：\n${postText.slice(0, 20000)}`,
    });
  return content;
}

const instruction = `你是 Live Idol 演出时间表结构化识别器。只提取提供的单场活动信息，输出 EventData v1.0。
若有管理员指定的 TIMETABLE SOURCE 图片，以该图的演出时间为准，微博正文用于交叉核对；若无时间表图，以微博正文为主要时间来源。Crop Source 上可能出现的时间优先级最低。
识别活动名称、日期、场地、OPEN、START、全部实际出演团体和每组 start_time/end_time；不要把 OPEN、START、特典会、物贩、交流会、票价、主办方或工作人员当团体。时间用 HH:mm，无法确认的字段留空，不根据相邻团体自动补时间。只出现月日时使用当前年份 ${new Date().getFullYear()}。
groups 按开始时间排列，id 从 group_001 连续编号。delay_minutes 固定 0。
所有 crop 仅相对于 GROUP VISUAL / CROP SOURCE，以 0 到 1 归一化坐标表示；找不到对应视觉时四项全 0。若完全没有 Crop Source，所有 crop 四项全 0。不要按 Timetable 图片计算 crop，除非它同时就是 Crop Source。
poster 宽高由程序覆盖，输出时可填 0。只输出 schema_version、event、delay_minutes、poster、groups；不要输出 city、微博信息、解释或推理。`;

export async function recognizeEvent(input: {
  timetable: AiImage | null;
  crop: AiImage | null;
  postText: string;
  mode: "normal" | "high";
  apiKey?: string;
  normalModel?: string;
  highModel?: string;
}): Promise<{
  data: EventData;
  warnings: string[];
  model: string;
  mode: "normal" | "high";
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
  const content = aiInputParts(input.timetable, input.crop, input.postText);
  const client = new OpenAI({
    apiKey: input.apiKey,
    timeout: 110_000,
    maxRetries: 0,
  });
  let response: OpenAI.Responses.Response;
  const started = Date.now();
  try {
    response = await client.responses.create({
      model,
      store: false,
      input: [
        { role: "system", content: instruction },
        { role: "user", content },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "live_idol_event_v1",
          strict: true,
          schema: EVENT_DATA_SCHEMA,
        },
      },
    });
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    const code =
      status === 401 || status === 403
        ? "AI_AUTH_ERROR"
        : status === 429
          ? "AI_RATE_LIMIT"
          : error instanceof OpenAI.APIConnectionTimeoutError
            ? "AI_TIMEOUT"
            : status === 400 || status === 404
              ? "AI_MODEL_ERROR"
              : "AI_REQUEST_FAILED";
    const message =
      code === "AI_AUTH_ERROR"
        ? "OpenAI 密钥无效，请检查服务器配置。"
        : code === "AI_RATE_LIMIT"
          ? "AI 请求过于频繁，请稍后再试。"
          : code === "AI_TIMEOUT"
            ? "AI 识别超时，请重试或使用手动 JSON。"
            : code === "AI_MODEL_ERROR"
              ? "AI 模型或请求配置有误，请检查服务器设置。"
              : "AI 识别失败，请重试或使用手动 JSON。";
    console.info("AI import", {
      model,
      success: false,
      code,
      latencyMs: Date.now() - started,
    });
    throw new AiImportError(
      code,
      message,
      code === "AI_RATE_LIMIT" ? 429 : 502,
    );
  }
  if (response.status !== "completed" || !response.output_text)
    throw new AiImportError(
      "AI_INVALID_OUTPUT",
      "AI 未返回完整结果，请重试或手动编辑。",
      502,
    );
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(response.output_text) as Record<string, unknown>;
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
  const candidate = {
    ...raw,
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
    success: true,
    latencyMs: Date.now() - started,
    groups: data.groups.length,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  });
  return { data, warnings, model, mode: input.mode };
}
