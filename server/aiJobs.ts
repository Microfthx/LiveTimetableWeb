import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiImage, AiUpstreamResponse } from "./aiImport.js";
import { AiImportError, recognizeEvent } from "./aiImport.js";

type JobStatus = "queued" | "running" | "completed" | "failed";
type SourceRole = "timetable" | "crop" | "cover";
export interface AiJobInput {
  timetable: AiImage | null;
  crop: AiImage | null;
  cover: AiImage | null;
  postText: string;
  sourceUrl?: string;
  mode: "normal" | "high";
  debug: boolean;
}
type AiJobResult = Awaited<ReturnType<typeof recognizeEvent>>;
export type AiJobRunner = (input: AiJobInput, onResponse: (response: AiUpstreamResponse) => Promise<void>) => Promise<AiJobResult>;
interface StoredImage { filename: string; mime: string; width: number; height: number }
interface StoredInput {
  timetable: StoredImage | null;
  crop: StoredImage | null;
  cover: StoredImage | null;
  postText: string;
  sourceUrl?: string;
  mode: "normal" | "high";
  debug: boolean;
}
interface StoredJob {
  id: string;
  status: JobStatus;
  mode: "normal" | "high";
  fingerprint: string;
  sourceUrl?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  hasRawResponse: boolean;
  rawComplete?: boolean;
  upstreamStatus?: number;
  contentType?: string | null;
  requestId?: string | null;
  model?: string;
  provider?: string;
  finishReason?: string;
  outputTokens?: number;
  reasoningTokens?: number;
  error?: { code: string; message: string };
}

const ID = /^[a-f0-9-]{36}$/;
const MAX_ACTIVE_JOBS = 10;
const RETAIN_MS = 30 * 24 * 60 * 60_000;
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function fingerprint(input: AiJobInput) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ mode: input.mode, debug: input.debug, postText: input.postText, sourceUrl: input.sourceUrl }));
  for (const image of [input.timetable, input.crop, input.cover]) {
    hash.update(image ? createHash("sha256").update(image.bytes).digest() : "none");
  }
  return hash.digest("hex");
}

export async function createAiJobQueue(
  dataDir: string,
  run: AiJobRunner,
) {
  const jobsDir = join(dataDir, "ai-jobs");
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const jobs = new Map<string, StoredJob>();
  const waiting: string[] = [];
  let running = false;
  let createChain: Promise<unknown> = Promise.resolve();
  const folder = (id: string) => join(jobsDir, id);
  const validId = (id: string) => ID.test(id) && jobs.has(id);

  async function writeAtomic(filename: string, content: string) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, filename);
  }
  async function persist(job: StoredJob) {
    await writeAtomic(join(folder(job.id), "job.json"), JSON.stringify(job));
  }
  async function storedImage(id: string, image: AiImage | null, known: Map<string, StoredImage>): Promise<StoredImage | null> {
    if (!image) return null;
    const digest = createHash("sha256").update(image.bytes).digest("hex");
    const reused = known.get(digest);
    if (reused) return reused;
    const filename = `image-${digest}.${EXTENSION[image.mime] ?? "bin"}`;
    await writeFile(join(folder(id), filename), image.bytes, { flag: "wx", mode: 0o600 });
    const value = { filename, mime: image.mime, width: image.width, height: image.height };
    known.set(digest, value);
    return value;
  }
  async function loadInput(id: string): Promise<AiJobInput> {
    const saved = JSON.parse(await readFile(join(folder(id), "input.json"), "utf8")) as StoredInput;
    const image = async (value: StoredImage | null): Promise<AiImage | null> => value
      ? { bytes: await readFile(join(folder(id), value.filename)), mime: value.mime, width: value.width, height: value.height }
      : null;
    const [timetable, crop, cover] = await Promise.all([image(saved.timetable), image(saved.crop), image(saved.cover)]);
    return { timetable, crop, cover, postText: saved.postText, sourceUrl: saved.sourceUrl, mode: saved.mode, debug: saved.debug };
  }
  async function processNext() {
    if (running) return;
    running = true;
    try {
      while (waiting.length) {
        const id = waiting.shift()!;
        const job = jobs.get(id);
        if (!job || job.status !== "queued") continue;
        job.status = "running";
        job.startedAt = new Date().toISOString();
        try {
          await persist(job);
          const input = await loadInput(id);
          const result = await run(input, async (upstream) => {
            await writeAtomic(join(folder(id), "raw-response.txt"), upstream.body);
            job.hasRawResponse = true;
            job.rawComplete = upstream.complete;
            job.upstreamStatus = upstream.status;
            job.contentType = upstream.contentType;
            job.requestId = upstream.requestId;
            try {
              const parsed = JSON.parse(upstream.body) as Record<string, unknown>;
              const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, unknown> | undefined : undefined;
              const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage as Record<string, unknown> : {};
              const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
                ? usage.completion_tokens_details as Record<string, unknown> : {};
              if (typeof parsed.model === "string") job.model = parsed.model;
              if (typeof parsed.provider === "string") job.provider = parsed.provider;
              if (typeof choice?.finish_reason === "string") job.finishReason = choice.finish_reason;
              if (typeof usage.completion_tokens === "number") job.outputTokens = usage.completion_tokens;
              if (typeof details.reasoning_tokens === "number") job.reasoningTokens = details.reasoning_tokens;
            } catch { /* Preserve malformed or partial upstream responses verbatim. */ }
            await persist(job);
          });
          await writeAtomic(join(folder(id), "result.json"), JSON.stringify(result));
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error = error instanceof AiImportError
            ? { code: error.code, message: error.message }
            : { code: "AI_JOB_FAILED", message: "AI 任务处理失败，请重试。" };
          if (!(error instanceof AiImportError)) console.error("AI job failed", id, error);
        }
        job.finishedAt = new Date().toISOString();
        await persist(job).catch((error) => console.error("AI job status save failed", id, error));
      }
    } finally { running = false; }
  }
  function schedule() { void processNext().catch((error) => console.error("AI job queue failed", error)); }
  async function cleanup() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if ((job.status === "completed" || job.status === "failed") && now - Date.parse(job.finishedAt ?? job.createdAt) > RETAIN_MS) {
        await rm(folder(id), { recursive: true, force: true });
        jobs.delete(id);
      }
    }
  }

  for (const entry of await readdir(jobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    try {
      const job = JSON.parse(await readFile(join(folder(entry.name), "job.json"), "utf8")) as StoredJob;
      if (job.id !== entry.name) continue;
      if (job.status === "running") {
        job.status = "failed";
        job.finishedAt = new Date().toISOString();
        job.error = { code: "AI_JOB_INTERRUPTED", message: "服务器重启中断了识别，请重新提交。" };
        await persist(job);
      }
      jobs.set(job.id, job);
      if (job.status === "queued") waiting.push(job.id);
    } catch (error) { console.error("AI job metadata unreadable", entry.name, error); }
  }
  waiting.sort((a, b) => jobs.get(a)!.createdAt.localeCompare(jobs.get(b)!.createdAt));
  await cleanup();
  schedule();

  async function add(input: AiJobInput) {
    const current = createChain.then(async () => {
      await cleanup();
      const key = fingerprint(input);
      const existing = [...jobs.values()].find((job) => job.fingerprint === key && (job.status === "queued" || job.status === "running"));
      if (existing) return summary(existing);
      if ([...jobs.values()].filter((job) => job.status === "queued" || job.status === "running").length >= MAX_ACTIVE_JOBS)
        throw new AiImportError("AI_QUEUE_FULL", "AI 队列已满，请稍后再提交。", 429);
      const id = randomUUID();
      const job: StoredJob = { id, status: "queued", mode: input.mode, fingerprint: key, sourceUrl: input.sourceUrl, createdAt: new Date().toISOString(), hasRawResponse: false };
      await mkdir(folder(id), { mode: 0o700 });
      try {
        const known = new Map<string, StoredImage>();
        const stored: StoredInput = {
          timetable: await storedImage(id, input.timetable, known),
          crop: await storedImage(id, input.crop, known),
          cover: await storedImage(id, input.cover, known),
          postText: input.postText, sourceUrl: input.sourceUrl, mode: input.mode, debug: input.debug,
        };
        await writeAtomic(join(folder(id), "input.json"), JSON.stringify(stored));
        await persist(job);
      } catch (error) { await rm(folder(id), { recursive: true, force: true }); throw error; }
      jobs.set(id, job);
      waiting.push(id);
      schedule();
      return summary(job);
    });
    createChain = current.catch(() => undefined);
    return current;
  }
  function summary(job: StoredJob) {
    return {
      id: job.id, status: job.status, mode: job.mode, sourceUrl: job.sourceUrl, createdAt: job.createdAt,
      startedAt: job.startedAt, finishedAt: job.finishedAt,
      queuePosition: job.status === "queued" ? waiting.indexOf(job.id) + 1 : 0,
      hasRawResponse: job.hasRawResponse, rawComplete: job.rawComplete, upstreamStatus: job.upstreamStatus,
      requestId: job.requestId, model: job.model, provider: job.provider,
      finishReason: job.finishReason, outputTokens: job.outputTokens, reasoningTokens: job.reasoningTokens,
      error: job.error,
    };
  }
  async function get(id: string) {
    if (!validId(id)) return null;
    const job = jobs.get(id)!;
    const saved = JSON.parse(await readFile(join(folder(id), "input.json"), "utf8")) as StoredInput;
    return {
      ...summary(job),
      postText: saved.postText,
      sources: Object.fromEntries((["timetable", "crop", "cover"] as const).map((role) => {
        const source = saved[role];
        return [role, source ? { url: `/api/admin/ai/jobs/${id}/sources/${role}`, width: source.width, height: source.height, mime: source.mime } : null];
      })),
      ...(job.status === "completed" ? { result: JSON.parse(await readFile(join(folder(id), "result.json"), "utf8")) as AiJobResult } : {}),
    };
  }
  async function source(id: string, role: SourceRole) {
    if (!validId(id)) return null;
    const saved = JSON.parse(await readFile(join(folder(id), "input.json"), "utf8")) as StoredInput;
    const image = saved[role];
    return image ? { filename: join(folder(id), image.filename), mime: image.mime } : null;
  }
  async function raw(id: string) {
    if (!validId(id) || !jobs.get(id)!.hasRawResponse) return null;
    return { body: await readFile(join(folder(id), "raw-response.txt"), "utf8"), contentType: jobs.get(id)!.contentType };
  }
  return {
    add, get, source, raw,
    list: () => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(summary),
  };
}
