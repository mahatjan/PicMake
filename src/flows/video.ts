/** 视频任务：提交、轮询、旧库导入。计时器只留在这个模块里，不进 store。 */
import { liveQuery } from "dexie";
import { toast } from "@heroui/react";
import { queryVideoTask, submitVideoTask } from "../api/video";
import { db } from "../db/schema";
import { readLegacyVideoStore } from "../db/legacy-video";
import { t } from "../i18n";
import { blobToDataUrl } from "../lib/blob";
import { uuid } from "../lib/uuid";
import {
  buildVideoBody,
  FRAME_WORKFLOW_ID,
  importLegacyVideo,
  isKnownWorkflow,
  planVideoSubmit,
  VIDEO_DURATION_MAX,
  VIDEO_MAX_FILE_BYTES,
  VIDEO_MAX_REFS,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_POLL_MAX_FAILS,
  VIDEO_POLL_MAX_MS,
  VIDEO_PROMPT_MAX,
  videoFileIssue,
  type VideoFailCode,
  type VideoIssue,
  type VideoRecord,
} from "../lib/video";
import { canOpenPlayground } from "../lib/workspace-rules";
import { useSettings } from "../store/settings";
import { useWorkspace, type VideoImageDraft } from "../store/workspace";
import {
  addVideoRefs,
  beginVideoSubmit,
  closeVideoPreview,
  consumeVideoDraft,
  endVideoSubmit,
  loadVideoDraft,
  openSettings,
  openVideoWithRef,
  setConfirm,
  setVideoFrame,
  videosLoaded,
} from "../store/workspace/actions";

const text = t as (key: string, options?: object) => string;

function issueText(issue: VideoIssue): string {
  return text(`video.issue.${issue}`, {
    max: issue === "prompt-too-long" ? VIDEO_PROMPT_MAX : VIDEO_MAX_REFS,
    maxSec: VIDEO_DURATION_MAX,
    maxMiB: VIDEO_MAX_FILE_BYTES / 1024 / 1024,
  });
}

function workflowName(id: string): string {
  if (!isKnownWorkflow(id)) return id;
  return text(`video.workflowName.${id}`);
}

function failReason(error: string | null, code: VideoFailCode | null): string {
  if (error) return error;
  return text(`video.fail.${code ?? "unknown"}`);
}

function framesMode(draft: {
  entry: "ref" | "frames" | "custom" | null;
  customInput: "refs" | "frames";
}): boolean {
  return (
    draft.entry === "frames" ||
    (draft.entry === "custom" && draft.customInput === "frames")
  );
}

export function addVideoFiles(files: File[]) {
  const draft = useWorkspace.getState().video.draft;
  if (!draft.entry) return;
  const accepted: VideoImageDraft[] = [];
  let issue: VideoIssue | null = null;
  for (const file of files) {
    const fileIssue = videoFileIssue(file);
    if (fileIssue) {
      issue = fileIssue;
      continue;
    }
    accepted.push({ id: uuid(), blob: file, name: file.name });
  }
  if (issue) toast(issueText(issue));
  if (!accepted.length) return;
  if (framesMode(draft)) {
    const slots = (["first", "last"] as const).filter(
      (slot) => !draft.frames[slot],
    );
    if (!slots.length) {
      toast(issueText("frames-full"));
      return;
    }
    slots.forEach((slot, index) => {
      const image = accepted[index];
      if (image) setVideoFrame(slot, image);
    });
    return;
  }
  if (addVideoRefs(accepted) > 0) toast(issueText("refs-full"));
}

export async function openVideoFromImage(imageId: string) {
  const state = useWorkspace.getState();
  if (!canOpenPlayground({ drawing: state.drawing !== null })) return;
  const memory = [
    ...state.tasks.flatMap((task) =>
      task.run.phase === "saving" || task.run.phase === "unsaved"
        ? [task.run.prepared]
        : [],
    ),
    state.history.recent,
  ]
    .flatMap((pack) => pack?.images ?? [])
    .find((image) => image.id === imageId);
  const stored = memory ?? (await db.images.get(imageId));
  if (!stored) {
    toast(text("video.imageMissing"));
    return;
  }
  const ext = stored.format === "jpeg" ? "jpg" : stored.format || "png";
  openVideoWithRef({ id: uuid(), blob: stored.blob, name: `image.${ext}` });
  toast(text("video.imageReady"));
}

export async function submitVideo() {
  if (!useWorkspace.getState().video.draft.entry) return;
  if (!beginVideoSubmit()) return;
  const draft = useWorkspace.getState().video.draft;
  const token = useSettings.getState().videoApiKey.trim();
  try {
    if (!draft.entry) return;
    const workflowId =
      draft.entry === "custom"
        ? draft.customWorkflowId
        : draft.entry === "frames"
          ? FRAME_WORKFLOW_ID
          : draft.refWorkflowId;
    const seedKey =
      draft.entry === "custom" ? draft.customWorkflowId.trim() : workflowId;
    const seed = Object.prototype.hasOwnProperty.call(draft.seeds, seedKey)
      ? draft.seeds[seedKey]
      : "";
    const planned = planVideoSubmit({
      hasKey: !!token,
      entry: draft.entry,
      workflowId,
      customInput: draft.customInput,
      prompt: draft.prompt,
      duration: draft.duration,
      resolution: draft.resolution,
      seed,
      refCount: draft.refs.length,
      hasFirst: !!draft.frames.first,
      hasLast: !!draft.frames.last,
    });
    if (!planned.ok) {
      if (planned.issue === "missing-key") openSettings();
      toast(issueText(planned.issue));
      return;
    }
    const plan = planned.plan;
    const images =
      plan.inputMode === "frames"
        ? [draft.frames.first, draft.frames.last].filter(
            (image): image is VideoImageDraft => !!image,
          )
        : draft.refs.slice(0, VIDEO_MAX_REFS);
    let dataUrls: string[];
    try {
      dataUrls = await Promise.all(
        images.map((image) => blobToDataUrl(image.blob)),
      );
    } catch {
      toast(issueText("read-failed"));
      return;
    }
    const id = `v_${uuid()}`;
    const row: VideoRecord = {
      id,
      status: "pending",
      taskId: "",
      workflow: plan.workflowId,
      entry: plan.entry,
      prompt: plan.prompt,
      duration: plan.duration,
      resolution: plan.resolution,
      seed: plan.seed,
      inputMode: plan.inputMode,
      refs: images.map((image, index) => ({
        blob: image.blob,
        name: image.name,
        role:
          plan.inputMode === "frames"
            ? index === 0
              ? "first"
              : "last"
            : undefined,
      })),
      remoteUrl: "",
      error: null,
      failCode: null,
      createdAt: Date.now(),
      finishedAt: null,
      pollFails: 0,
    };
    try {
      await db.videos.put(row);
    } catch {
      toast(text("video.toast.saveFailed"));
      return;
    }
    consumeVideoDraft();
    toast(
      text("video.toast.submitted", {
        workflow: workflowName(plan.workflowId),
        resolution: plan.resolution,
        duration: plan.duration,
      }),
    );
    const result = await submitVideoTask(
      token,
      plan.workflowId,
      buildVideoBody(plan, dataUrls),
    );
    const latest = await db.videos.get(id);
    if (!latest || latest.status !== "pending") return;
    if (!result.ok) {
      const failure = result.failure;
      const serverText =
        "message" in failure && failure.message ? failure.message : null;
      const keepServer =
        (failure.kind === "http" || failure.kind === "rejected") &&
        !!serverText;
      const failCode: VideoFailCode =
        failure.kind === "timeout"
          ? "submit-timeout"
          : failure.kind === "network"
            ? "network"
            : "no-task";
      await db.videos.update(id, {
        status: "error",
        error: keepServer ? serverText : null,
        failCode: keepServer ? null : failCode,
      });
      toast(
        text("video.toast.failed", {
          reason: failReason(
            keepServer ? serverText : null,
            keepServer ? null : failCode,
          ),
        }),
      );
      return;
    }
    await db.videos.update(id, { taskId: result.taskId });
  } finally {
    endVideoSubmit();
  }
}

async function markFailed(
  id: string,
  patch: { error?: string | null; failCode?: VideoFailCode | null },
) {
  const current = await db.videos.get(id);
  if (!current || current.status !== "pending") return;
  await db.videos.update(id, {
    status: "error",
    error: patch.error ?? null,
    failCode: patch.failCode ?? null,
  });
  toast(
    text("video.toast.failed", {
      reason: failReason(patch.error ?? null, patch.failCode ?? null),
    }),
  );
}

let polling = false;

async function pollOne(id: string, token: string) {
  const row = await db.videos.get(id);
  if (!row || row.status !== "pending" || !row.taskId) return;
  if (Date.now() - row.createdAt > VIDEO_POLL_MAX_MS) {
    await markFailed(id, { failCode: "wait-timeout" });
    return;
  }
  const result = await queryVideoTask(token, row.taskId);
  const fresh = await db.videos.get(id);
  if (!fresh || fresh.status !== "pending") return;
  if (!result.ok) {
    const fails = fresh.pollFails + 1;
    if (fails >= VIDEO_POLL_MAX_FAILS) {
      await markFailed(id, {
        error:
          result.failure.kind === "http"
            ? result.failure.message || null
            : null,
        failCode: "poll-exhausted",
      });
      return;
    }
    await db.videos.update(id, { pollFails: fails });
    return;
  }
  if (result.poll.kind === "pending") {
    if (fresh.pollFails) await db.videos.update(id, { pollFails: 0 });
    return;
  }
  if (result.poll.kind === "success") {
    await db.videos.update(id, {
      status: "done",
      remoteUrl: result.poll.url,
      finishedAt: Date.now(),
      pollFails: 0,
      error: null,
      failCode: null,
    });
    toast(text("video.toast.done"));
    return;
  }
  await markFailed(
    id,
    result.poll.message
      ? { error: result.poll.message, failCode: null }
      : { failCode: "no-url" },
  );
}

async function pollPending() {
  if (polling) return;
  const token = useSettings.getState().videoApiKey.trim();
  if (!token) return;
  polling = true;
  try {
    const rows = await db.videos
      .filter((row) => row.status === "pending" && !!row.taskId)
      .toArray();
    for (const row of rows) await pollOne(row.id, token);
  } finally {
    polling = false;
  }
}

async function settleInterrupted() {
  const stuck = await db.videos
    .filter((row) => row.status === "pending" && !row.taskId)
    .toArray();
  await Promise.all(
    stuck.map((row) =>
      db.videos.update(row.id, { status: "error", failCode: "interrupted" }),
    ),
  );
}

let importTask: Promise<void> | null = null;

function importLegacyVideosOnce(): Promise<void> {
  if (useSettings.getState().videoLegacyImported) return Promise.resolve();
  if (importTask) return importTask;
  importTask = (async () => {
    const raw = await readLegacyVideoStore();
    if (raw === null) {
      importTask = null;
      return;
    }
    const rows = raw
      .map(importLegacyVideo)
      .filter((row): row is VideoRecord => !!row);
    if (rows.length) {
      const existing = new Set(await db.videos.toCollection().primaryKeys());
      const fresh = rows.filter((row) => !existing.has(row.id));
      if (fresh.length) await db.videos.bulkPut(fresh);
    }
    useSettings.getState().markVideoLegacyImported();
  })().catch((error: unknown) => {
    importTask = null;
    console.warn(error);
  });
  return importTask;
}

/** App 挂载时启动：订阅记录、导入旧库、恢复未完成任务。返回 cleanup 清掉轮询。 */
export function startVideoSync(): () => void {
  void importLegacyVideosOnce();
  void settleInterrupted();
  const subscription = liveQuery(() =>
    db.videos.orderBy("createdAt").reverse().toArray(),
  ).subscribe({
    next: videosLoaded,
    error: () => toast(text("video.toast.loadFailed")),
  });
  const timer = setInterval(() => {
    void pollPending();
  }, VIDEO_POLL_INTERVAL_MS);
  void pollPending();
  return () => {
    subscription.unsubscribe();
    clearInterval(timer);
  };
}

export function reuseVideo(id: string) {
  const row = useWorkspace
    .getState()
    .video.rows?.find((item) => item.id === id);
  if (!row) return;
  if (!row.refs.length) {
    toast(text("video.noRefs"));
    return;
  }
  loadVideoDraft(row);
  toast(text("video.toast.reused"));
}

export function downloadVideo(id: string) {
  const row = useWorkspace
    .getState()
    .video.rows?.find((item) => item.id === id);
  if (!row?.remoteUrl) return;
  const anchor = document.createElement("a");
  anchor.href = row.remoteUrl;
  anchor.download = `PicMake-${row.id.slice(0, 8)}.mp4`;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.click();
}

export function deleteVideo(id: string) {
  setConfirm({
    title: text("video.deleteTitle"),
    desc: text("video.deleteDesc"),
    okLabel: text("video.delete"),
    onOk: () => {
      void db.videos.delete(id).then(() => {
        if (useWorkspace.getState().video.previewId === id) closeVideoPreview();
        toast(t("toast.deleted"));
      });
    },
  });
}

export function confirmClearVideos() {
  setConfirm({
    title: text("video.clearTitle"),
    desc: text("video.clearDesc"),
    okLabel: text("video.clear"),
    onOk: () => {
      void db.videos.clear().then(() => {
        closeVideoPreview();
        toast(text("video.toast.cleared"));
      });
    },
  });
}
