import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAiJobQueue, type AiJobInput } from "./aiJobs";
import { demoData } from "../src/data/demo";

const folders: string[] = [];
afterAll(async () => {
  for (const folder of folders) {
    if (!resolve(folder).startsWith(resolve(tmpdir(), "ai-jobs-test-"))) throw new Error("Unsafe test cleanup path");
    await rm(folder, { recursive: true, force: true });
  }
});

it("queues one recognition at a time, deduplicates active inputs, and retains exact upstream responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-jobs-test-"));
  folders.push(directory);
  const image = { bytes: Buffer.from("test-image"), mime: "image/png", width: 2, height: 3 };
  const input = (postText: string): AiJobInput => ({ timetable: image, crop: image, cover: null, postText, mode: "normal", debug: false });
  const started: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const raw = '{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}';
  const runner = vi.fn(async (job: AiJobInput, onResponse: (response: { status: number; contentType: string; requestId: string; body: string; complete: boolean }) => Promise<void>) => {
    started.push(job.postText);
    expect(job.timetable?.bytes).toEqual(image.bytes);
    if (job.postText === "first") await firstGate;
    await onResponse({ status: 200, contentType: "application/json", requestId: "test-request", body: raw, complete: true });
    return { data: demoData, city: "厦门", warnings: [], model: "test-model", mode: "normal" as const };
  });
  const queue = await createAiJobQueue(directory, runner);
  const first = await queue.add(input("first"));
  await vi.waitFor(() => expect(started).toEqual(["first"]));
  const second = await queue.add(input("second"));
  expect((await queue.add(input("first"))).id).toBe(first.id);
  expect((await queue.get(second.id))?.status).toBe("queued");
  expect(started).toEqual(["first"]);
  releaseFirst();
  await vi.waitFor(async () => expect((await queue.get(second.id))?.status).toBe("completed"));
  expect(started).toEqual(["first", "second"]);
  expect((await queue.get(first.id))?.result?.data.event.title).toBe(demoData.event.title);
  expect((await queue.raw(first.id))?.body).toBe(raw);
  expect((await queue.get(first.id))?.hasRawResponse).toBe(true);
  expect((await queue.get(first.id))?.rawComplete).toBe(true);
  expect((await queue.get(first.id))?.finishReason).toBe("length");
  const source = await queue.source(first.id, "crop");
  expect(source?.mime).toBe("image/png");
  expect(await readFile(source!.filename)).toEqual(image.bytes);
  const reopened = await createAiJobQueue(directory, runner);
  expect((await reopened.get(first.id))?.status).toBe("completed");
  expect((await reopened.raw(first.id))?.body).toBe(raw);
  expect(runner).toHaveBeenCalledTimes(2);
});

it("marks an interrupted running job as failed on restart without silently charging for another request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-jobs-test-"));
  folders.push(directory);
  const queue = await createAiJobQueue(directory, async () => ({ data: demoData, city: "", warnings: [], model: "test", mode: "normal" }));
  const submitted = await queue.add({ timetable: null, crop: null, cover: null, postText: "14:00 Gara", mode: "normal", debug: false });
  await vi.waitFor(async () => expect((await queue.get(submitted.id))?.status).toBe("completed"));
  const filename = join(directory, "ai-jobs", submitted.id, "job.json");
  const saved = JSON.parse(await readFile(filename, "utf8"));
  await writeFile(filename, JSON.stringify({ ...saved, status: "running", finishedAt: undefined }));
  const runner = vi.fn(async () => ({ data: demoData, city: "", warnings: [], model: "test", mode: "normal" as const }));
  const reopened = await createAiJobQueue(directory, runner);
  expect((await reopened.get(submitted.id))?.error?.code).toBe("AI_JOB_INTERRUPTED");
  expect(runner).not.toHaveBeenCalled();
});
