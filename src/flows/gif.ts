/** GIF 工作台流程：导入、项目读写、图层素材、导出与入口联动。计时器/Worker 都留在 flow。 */
import { liveQuery } from "dexie";
import { toast } from "@heroui/react";
import { db } from "../db/schema";
import {
  clearGifData,
  deleteGifProjectData,
  listGifProjects,
  loadGifAssets,
  loadGifProject,
  putGifAsset,
  putGifProject,
} from "../db/gif";
import { t } from "../i18n";
import { decodeGif, closeDecodedGif, GifDecodeError } from "../lib/gif/decode";
import { applyChromaKey, parseHexColor } from "../lib/gif/chroma";
import { GifEncoderClient } from "../lib/gif/encode";
import {
  clampSourceDuration,
  canvasToBlob,
  decodeImage,
  fileIssue,
  fileKind,
  loadVideoElement,
  seekVideo,
  sourceDurationIssue,
  thumbnailBlob,
  videoSize,
} from "../lib/gif/media";
import { createGifProject } from "../lib/gif/project";
import { planGifExport, type GifExportPlan } from "../lib/gif/export-plan";
import {
  createTextLayer,
  createDoodleLayer,
  createGifLayer as makeGifLayer,
  createImageLayer,
  gifLayerPixelUsage,
} from "../lib/gif/layers";
import {
  exportDimensions,
  exportFrameIssue,
  exportFrameSchedule,
  outputDuration,
} from "../lib/gif/timeline";
import {
  GIF_MAX_FRAMES,
  GIF_MAX_GIF_LAYER_FRAMES,
  GIF_MAX_GIF_LAYER_SIDE,
  GIF_MAX_LAYER_PIXELS,
  GIF_MAX_LAYERS,
  type GifAsset,
  type GifIssue,
  type GifProject,
  type GifSourceKind,
} from "../lib/gif/types";
import {
  gifFrameAt,
  renderProjectFrame,
  type GifRenderAssets,
} from "../lib/gif/render";
import { uuid } from "../lib/uuid";
import { useWorkspace } from "../store/workspace";
import { useSettings } from "../store/settings";
import { requestImages } from "../api/client";
import { b64Format, b64ToBlob } from "../lib/blob";
import type { EditSubmission, GenParams } from "../lib/types";
import {
  addGifAsset,
  addGifLayer,
  beginGifExport,
  beginGifImport,
  clearGifExport,
  clearGifImport,
  closeGif,
  closeGifProject,
  failGifExport,
  failGifImport,
  finishGifExport,
  gifExportProgress,
  gifImportProgress,
  gifProjectsLoaded,
  gifSaved,
  gifSaving,
  loadGifProject as loadGifProjectIntoStore,
  openGif as openGifWorkspace,
  patchGifLayer,
  setConfirm,
  startGifProject,
} from "../store/workspace/actions";

const text = t as (key: string, options?: object) => string;

function issueText(issue: GifIssue): string {
  return text(`gif.issue.${issue}`);
}

const KNOWN_ISSUES = new Set<string>([
  "unsupported-type",
  "unsupported-codec",
  "file-too-large",
  "too-long",
  "read-failed",
  "metadata-failed",
  "no-frames",
  "too-many-frames",
  "decode-failed",
  "gif-too-large",
  "gif-too-many-frames",
  "export-failed",
  "cancelled",
  "quota",
  "missing-asset",
  "cors",
  "empty-text",
  "text-too-long",
  "too-many-layers",
  "no-source",
  "save-failed",
  "load-failed",
]);

function errorIssue(error: unknown): GifIssue {
  if (error instanceof GifDecodeError) return error.code;
  if (error instanceof Error) {
    if (KNOWN_ISSUES.has(error.message)) return error.message as GifIssue;
    if (error.message === "canvas-failed") return "read-failed";
  }
  return "export-failed";
}

function baseName(name: string): string {
  const clean = name.replace(/\.[^.]+$/, "").trim();
  return clean || "GIF";
}

/** 配额不足：DOMException 与 Dexie 自己的 QuotaError 都要认（后者不是 DOMException） */
function isQuota(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/* ── 项目列表 ── */

export function startGifSync(): () => void {
  const subscription = liveQuery(listGifProjects).subscribe({
    next: gifProjectsLoaded,
    error: () => toast(text("gif.toast.loadFailed")),
  });
  return () => subscription.unsubscribe();
}

/* ── 导入 ── */

interface ImportedSource {
  kind: GifSourceKind;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  durationMs: number;
  name: string;
  thumb: Blob | null;
  hasTransparency: boolean;
}

function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

async function gifHasTransparency(frames: ImageBitmap[]): Promise<boolean> {
  for (const frame of frames) {
    if (bitmapHasTransparency(frame)) return true;
  }
  return false;
}

async function inspectSource(
  blob: Blob,
  name: string,
  kind: GifSourceKind,
): Promise<ImportedSource> {
  if (kind === "video") {
    const url = URL.createObjectURL(blob);
    const video = await loadVideoElement(url);
    try {
      const size = videoSize(video);
      const issue = sourceDurationIssue(size.durationMs);
      if (issue === "too-long") toast(issueText(issue));
      await seekVideo(video, 0);
      const thumb = await thumbnailBlob(video, size.width, size.height);
      return {
        kind,
        blob,
        mime: blob.type || "video/mp4",
        hasTransparency: false,
        width: size.width,
        height: size.height,
        durationMs: clampSourceDuration(size.durationMs),
        name,
        thumb,
      };
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  if (kind === "gif") {
    const decoded = await decodeGif(blob, {
      maxFrames: GIF_MAX_FRAMES,
      maxSide: 1024,
    });
    try {
      const issue = sourceDurationIssue(decoded.totalMs);
      if (issue === "too-long") toast(issueText(issue));
      const thumb = await thumbnailBlob(
        decoded.frames[0],
        decoded.width,
        decoded.height,
      );
      return {
        kind,
        blob,
        mime: blob.type || "image/gif",
        hasTransparency: await gifHasTransparency(decoded.frames),
        width: decoded.width,
        height: decoded.height,
        durationMs: clampSourceDuration(decoded.totalMs),
        name,
        thumb,
      };
    } finally {
      closeDecodedGif(decoded);
    }
  }
  const image = await decodeImage(blob, 1920);
  try {
    const thumb = await thumbnailBlob(image.bitmap, image.width, image.height);
    const hasTransparency = bitmapHasTransparency(image.bitmap);
    return {
      kind: "image",
      blob,
      mime: blob.type || "image/png",
      hasTransparency,
      width: image.width,
      height: image.height,
      durationMs: 2000,
      name,
      thumb,
    };
  } finally {
    image.bitmap.close();
  }
}

async function importSourceFile(
  blob: Blob,
  name: string,
  kind: GifSourceKind,
): Promise<void> {
  const before = useWorkspace.getState();
  if (before.gif.project) {
    if (before.gif.dirty && !(await saveGifProjectNow(before.gif.project)))
      return;
    const current = useWorkspace.getState().gif;
    if (current.project?.id !== before.gif.project.id || current.dirty) return;
    closeGifProject();
  }
  const jobId = uuid();
  openGifWorkspace();
  beginGifImport(jobId, name);
  try {
    const source = await inspectSource(blob, name, kind);
    gifImportProgress(0.5);
    const sourceAssetId = `a_${uuid()}`;
    const project = createGifProject({
      source: {
        kind: source.kind,
        assetId: sourceAssetId,
        width: source.width,
        height: source.height,
        durationMs: source.durationMs,
      },
      title: baseName(name),
    });
    if (source.hasTransparency) {
      project.canvas.background = { kind: "transparent" };
      project.export.transparent = true;
    }
    project.thumbBytes = source.thumb
      ? new Uint8Array(await source.thumb.arrayBuffer())
      : undefined;
    const asset: GifAsset = {
      id: sourceAssetId,
      projectId: project.id,
      kind: "source",
      blob: source.blob,
      mime: source.mime,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      name,
    };
    await putGifAsset(asset);
    await putGifProject(project);
    gifImportProgress(1);
    clearGifImport();
    startGifProject(project, { [asset.id]: asset });
    toast(text("gif.toast.imported", { name: baseName(name) }));
    if (exportFrameIssue(project.timeline, project.export.fps))
      toast(issueText("too-many-frames"));
  } catch (error) {
    clearGifImport();
    if (isQuota(error)) {
      failGifImport("quota");
      toast(issueText("quota"));
      return;
    }
    const issue = errorIssue(error);
    failGifImport(issue);
    toast(issueText(issue));
  }
}

/** 本地文件入口：一次只处理第一个支持的文件 */
export async function importGifFile(
  file: File | null | undefined,
): Promise<void> {
  if (!file) return;
  const kind = fileKind(file);
  if (!kind) {
    toast(issueText("unsupported-type"));
    return;
  }
  const issue = fileIssue(file, kind);
  if (issue) {
    toast(issueText(issue));
    return;
  }
  await importSourceFile(file, file.name, kind);
}

/** 从远端视频链接导入（视频工作台结果） */
export async function importGifFromUrl(
  url: string,
  name: string,
): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("cors");
    const blob = await response.blob();
    await importSourceFile(blob, name || "video.mp4", "video");
  } catch {
    toast(issueText("cors"));
  }
}

export async function openGifFromVideoRecord(id: string): Promise<void> {
  const row = useWorkspace
    .getState()
    .video.rows?.find((item) => item.id === id);
  if (!row?.remoteUrl) {
    toast(issueText("no-source"));
    return;
  }
  await importGifFromUrl(row.remoteUrl, `video-${id.slice(0, 6)}.mp4`);
}

/** 新建涂鸦图层：手绘笔迹直接进入合成，导出也会带上 */
export function addGifDoodleLayer(): void {
  const project = useWorkspace.getState().gif.project;
  if (!project) return;
  const duration = Math.max(100, outputDuration(project.timeline));
  const layer = createDoodleLayer({ duration });
  if (addGifLayer(layer)) toast(text("gif.toast.layerAdded"));
}

/** AI 贴纸：调文生图接口生成一张贴纸，作为图片图层加进项目 */
export async function addGifAiSticker(prompt: string): Promise<boolean> {
  const project = useWorkspace.getState().gif.project;
  if (!project) return false;
  const trimmed = prompt.trim().slice(0, 200);
  if (!trimmed) return false;
  const { baseUrl, apiKey, streamEnabled } = useSettings.getState();
  if (!apiKey) {
    toast(text("gif.toast.needApiKey"));
    return false;
  }
  const params: GenParams = {
    model: "gpt2",
    prompt: `${trimmed}${text("gif.sticker.promptSuffix")}`,
    size: { w: 1024, h: 1024 },
    quality: "high",
    n: 1,
    background: "transparent",
    outputFormat: "png",
  };
  try {
    const result = await requestImages(params, {
      baseUrl,
      apiKey,
      streamEnabled,
    });
    const b64 = result.images[0];
    if (!b64) {
      toast(text("gif.toast.stickerFailed"));
      return false;
    }
    const format = b64Format(b64) ?? "png";
    const blob = b64ToBlob(b64, `image/${format}`);
    const decoded = await decodeImage(blob, 1024);
    const assetId = `a_${uuid()}`;
    const asset: GifAsset = {
      id: assetId,
      projectId: project.id,
      kind: "image",
      blob,
      mime: `image/${format}`,
      width: decoded.width,
      height: decoded.height,
      name: "sticker.png",
    };
    await putGifAsset(asset);
    addGifAsset(asset);
    const duration = Math.max(100, outputDuration(project.timeline));
    const layer = createImageLayer({
      assetId,
      name: trimmed.slice(0, 16),
      duration,
      width: 0.45,
    });
    if (!addGifLayer(layer)) return false;
    toast(text("gif.toast.stickerAdded"));
    return true;
  } catch {
    toast(text("gif.toast.stickerFailed"));
    return false;
  }
}

/** AI 智能抠图：把图层图片交给图片编辑接口做主体分离，产出透明底 PNG 替换原图 */
export async function applyGifAiCutout(layerId: string): Promise<boolean> {
  const state = useWorkspace.getState();
  const project = state.gif.project;
  if (!project) return false;
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer || layer.kind !== "image") return false;
  const asset = state.gif.assets[layer.assetId];
  if (!asset) {
    toast(issueText("missing-asset"));
    return false;
  }
  const { baseUrl, apiKey, streamEnabled } = useSettings.getState();
  if (!apiKey) {
    toast(text("gif.toast.needApiKey"));
    return false;
  }
  const params: GenParams = {
    model: "gpt2",
    prompt: text("gif.cutout.prompt"),
    size: "auto",
    quality: "high",
    n: 1,
    background: "transparent",
    outputFormat: "png",
  };
  const edit: EditSubmission = {
    sources: [
      {
        source: { imageId: asset.id, name: asset.name },
        image: {
          id: asset.id,
          blob: asset.blob,
          width: asset.width,
          height: asset.height,
          format: asset.mime === "image/jpeg" ? "jpeg" : "png",
        },
      },
    ],
    inputFidelity: "auto",
  };
  try {
    const result = await requestImages(
      params,
      { baseUrl, apiKey, streamEnabled },
      {},
      edit,
    );
    const b64 = result.images[0];
    if (!b64) {
      toast(text("gif.toast.cutoutFailed"));
      return false;
    }
    const format = b64Format(b64) ?? "png";
    const blob = b64ToBlob(b64, `image/${format}`);
    const decoded = await decodeImage(blob, 1600);
    const assetId = `a_${uuid()}`;
    const next: GifAsset = {
      id: assetId,
      projectId: project.id,
      kind: "image",
      blob,
      mime: `image/${format}`,
      width: decoded.width,
      height: decoded.height,
      name: asset.name,
    };
    await putGifAsset(next);
    addGifAsset(next);
    patchGifLayer(layerId, { assetId }, true);
    toast(text("gif.toast.cutoutDone"));
    return true;
  } catch {
    toast(text("gif.toast.cutoutFailed"));
    return false;
  }
}

/** 抠图：把图片图层里接近 key 色的像素变透明，产出新的 PNG 素材替换原图 */
export async function applyGifChromaKey(
  layerId: string,
  color: string,
  tolerance: number,
): Promise<void> {
  const state = useWorkspace.getState();
  const project = state.gif.project;
  if (!project) return;
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer || layer.kind !== "image") return;
  const asset = state.gif.assets[layer.assetId];
  if (!asset) {
    toast(issueText("missing-asset"));
    return;
  }
  try {
    const decoded = await decodeImage(asset.blob, 1600);
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas-failed");
    ctx.drawImage(decoded.bitmap, 0, 0);
    decoded.bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyChromaKey(image.data, parseHexColor(color), tolerance);
    ctx.putImageData(image, 0, 0);
    const blob = await canvasToBlob(canvas, "image/png");
    const assetId = `a_${uuid()}`;
    const next: GifAsset = {
      id: assetId,
      projectId: project.id,
      kind: "image",
      blob,
      mime: "image/png",
      width: canvas.width,
      height: canvas.height,
      name: asset.name,
    };
    await putGifAsset(next);
    addGifAsset(next);
    patchGifLayer(layerId, { assetId }, true);
    toast(text("gif.toast.chromaDone"));
  } catch {
    toast(issueText("export-failed"));
  }
}

export async function openGifFromImage(imageId: string): Promise<void> {
  const image = await db.images.get(imageId);
  if (!image) {
    toast(issueText("missing-asset"));
    return;
  }
  const kind: GifSourceKind = image.format === "gif" ? "gif" : "image";
  const ext = image.format === "jpeg" ? "jpg" : image.format || "png";
  await importSourceFile(
    image.blob,
    `image-${imageId.slice(0, 6)}.${ext}`,
    kind,
  );
}

/** 我的作品：已保存的生成图，按时间倒序（GIF 首页的「从我的作品选择」） */
export interface GifWorkImage {
  id: string;
  width: number;
  height: number;
  prompt: string;
  createdAt: number;
  blob: Blob;
}

/** 一次最多列出的作品数，避免一次把整个图片库读进内存 */
const GIF_WORK_LIMIT = 48;

export async function listGifWorkImages(): Promise<GifWorkImage[]> {
  const rows = await db.history.orderBy("createdAt").reverse().toArray();
  const items: GifWorkImage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const imageId of row.imageIds) {
      if (seen.has(imageId)) continue;
      seen.add(imageId);
      if (items.length >= GIF_WORK_LIMIT) break;
      const image = await db.images.get(imageId);
      if (!image) continue;
      items.push({
        id: imageId,
        width: image.width,
        height: image.height,
        prompt: row.prompt,
        createdAt: row.createdAt,
        blob: image.blob,
      });
    }
    if (items.length >= GIF_WORK_LIMIT) break;
  }
  return items;
}

/* ── 打开/保存/删除 ── */

export async function openGifProject(id: string): Promise<void> {
  try {
    const project = await loadGifProject(id);
    if (!project) {
      toast(issueText("load-failed"));
      return;
    }
    const assets = await loadGifAssets(id);
    loadGifProjectIntoStore(project, assets);
  } catch {
    toast(issueText("load-failed"));
  }
}

// 自动保存和离开前保存串行写入，避免旧快照晚于新快照落库。
let gifSaveQueue: Promise<void> = Promise.resolve();

export function saveGifProjectNow(project: GifProject): Promise<boolean> {
  const save = gifSaveQueue.then(async () => {
    if (useWorkspace.getState().gif.project !== project) return false;
    gifSaving(true);
    try {
      await putGifProject(project);
      const current = useWorkspace.getState().gif.project;
      if (current === project) {
        gifSaved(project);
        return true;
      }
      gifSaving(false);
    } catch (error) {
      gifSaving(false);
      toast(issueText(isQuota(error) ? "quota" : "save-failed"));
    }
    return false;
  });
  gifSaveQueue = save.then(() => undefined);
  return save;
}

/** 离开前保存失败时保留现场；明确放弃才清掉会话，返回编辑器后可再次离开重试。 */
async function leaveGif(destination: "home" | "workspace"): Promise<void> {
  const state = useWorkspace.getState();
  if (state.gif.exportJob?.status === "running") {
    toast(text("gif.toast.exporting"));
    return;
  }
  const project = state.gif.project;
  const leave = () => {
    if (destination === "home") closeGifProject();
    else closeGif();
  };
  if (!project) {
    leave();
    return;
  }
  const saved = !state.gif.dirty || (await saveGifProjectNow(project));
  const current = useWorkspace.getState().gif;
  if (current.project?.id !== project.id) return;
  if (!saved) {
    // 保存期间产生的新修改继续留在编辑器，不把它当作存储失败。
    if (current.project !== project) return;
    setConfirm({
      title: text("gif.saveFailedTitle"),
      desc: text("gif.saveFailedDesc"),
      okLabel: text("gif.discardChanges"),
      cancelLabel: text("gif.keepEditing"),
      onOk: () => {
        const latest = useWorkspace.getState().gif;
        if (
          latest.project !== project ||
          latest.exportJob?.status === "running"
        )
          return;
        closeGifProject();
        if (destination === "workspace") closeGif();
      },
    });
    return;
  }
  if (current.dirty || current.exportJob?.status === "running") return;
  leave();
}

export async function leaveGifProject(): Promise<void> {
  await leaveGif("home");
}

/** 顶栏关闭工作台：与返回首页使用相同的保存守卫。 */
export async function leaveGifWorkspace(): Promise<void> {
  await leaveGif("workspace");
}

export function deleteGifProject(id: string): void {
  setConfirm({
    title: text("gif.deleteTitle"),
    desc: text("gif.deleteDesc"),
    okLabel: text("gif.delete"),
    onOk: () => {
      void deleteGifProjectData(id).then(() => {
        if (useWorkspace.getState().gif.project?.id === id) closeGifProject();
        toast(text("gif.toast.deleted"));
      });
    },
  });
}

export function clearGifProjects(): void {
  setConfirm({
    title: text("gif.clearTitle"),
    desc: text("gif.clearDesc"),
    okLabel: text("gif.clear"),
    onOk: () => {
      void clearGifData().then(() => {
        closeGifProject();
        toast(text("gif.toast.cleared"));
      });
    },
  });
}

/* ── 图层素材 ── */

export async function addGifLayerFile(
  file: File | null | undefined,
): Promise<void> {
  if (!file) return;
  const state = useWorkspace.getState();
  const project = state.gif.project;
  if (!project) return;
  const assets = state.gif.assets;
  if (project.layers.length >= GIF_MAX_LAYERS) {
    toast(issueText("too-many-layers"));
    return;
  }
  const kind = fileKind(file);
  if (kind !== "image" && kind !== "gif") {
    toast(issueText("unsupported-type"));
    return;
  }
  const issue = fileIssue(file, kind);
  if (issue) {
    toast(issueText(issue));
    return;
  }
  try {
    let width = 1;
    let height = 1;
    let frames = 0;
    if (kind === "gif") {
      const decoded = await decodeGif(file, {
        maxFrames: GIF_MAX_GIF_LAYER_FRAMES,
        maxSide: GIF_MAX_GIF_LAYER_SIDE,
      });
      width = decoded.width;
      height = decoded.height;
      frames = decoded.frames.length;
      closeDecodedGif(decoded);
      // 动图解码后常驻内存：超预算先拦住，别把标签页拖垮
      const used = gifLayerPixelUsage(project.layers, assets);
      if (used + width * height * frames > GIF_MAX_LAYER_PIXELS) {
        toast(text("gif.toast.layerBudget"));
        return;
      }
    } else {
      const image = await decodeImage(file, 1920);
      width = image.width;
      height = image.height;
      image.bitmap.close();
    }
    const assetId = `a_${uuid()}`;
    const asset: GifAsset = {
      id: assetId,
      projectId: project.id,
      kind,
      blob: file,
      mime: file.type || (kind === "gif" ? "image/gif" : "image/png"),
      width,
      height,
      durationMs: 0,
      frames: frames || undefined,
      name: file.name,
    };
    await putGifAsset(asset);
    addGifAsset(asset);
    const duration = Math.max(100, outputDuration(project.timeline));
    const layer =
      kind === "gif"
        ? makeGifLayer({ assetId, name: file.name, duration })
        : createImageLayer({ assetId, name: file.name, duration });
    if (!addGifLayer(layer)) {
      toast(issueText("too-many-layers"));
      return;
    }
    toast(text("gif.toast.layerAdded"));
  } catch (error) {
    if (isQuota(error)) {
      toast(issueText("quota"));
      return;
    }
    const issue = errorIssue(error);
    toast(issueText(issue));
  }
}

export function addGifTextLayer(): void {
  const project = useWorkspace.getState().gif.project;
  if (!project) return;
  if (project.layers.length >= GIF_MAX_LAYERS) {
    toast(issueText("too-many-layers"));
    return;
  }
  const layer = createTextLayer({
    text: text("gif.text.defaultText"),
    duration: Math.max(100, outputDuration(project.timeline)),
  });
  addGifLayer(layer);
}

/* ── 导出 ── */

interface PreparedAssets {
  render: GifRenderAssets;
  sourceImage: ImageBitmap | null;
  sourceGif: Awaited<ReturnType<typeof decodeGif>> | null;
  video: HTMLVideoElement | null;
  close: () => void;
}

async function prepareAssets(
  project: GifProject,
  assets: Record<string, GifAsset>,
  sourceUrl: string | null,
): Promise<PreparedAssets> {
  const render: GifRenderAssets = {};
  const closers: (() => void)[] = [];
  let sourceImage: ImageBitmap | null = null;
  let sourceGif: Awaited<ReturnType<typeof decodeGif>> | null = null;
  let video: HTMLVideoElement | null = null;

  for (const layer of project.layers) {
    if (layer.kind !== "image" && layer.kind !== "gif") continue;
    const asset = assets[layer.assetId];
    if (!asset) throw new Error("missing-asset");
    if (layer.kind === "image") {
      const image = await decodeImage(asset.blob, 1600);
      render[layer.assetId] = {
        image: image.bitmap,
        width: image.width,
        height: image.height,
      };
      closers.push(() => image.bitmap.close());
    } else {
      const gif = await decodeGif(asset.blob, {
        maxFrames: GIF_MAX_GIF_LAYER_FRAMES,
        maxSide: GIF_MAX_GIF_LAYER_SIDE,
      });
      render[layer.assetId] = {
        gif: {
          frames: gif.frames,
          durations: gif.durations,
          totalMs: gif.totalMs,
          width: gif.width,
          height: gif.height,
        },
        width: gif.width,
        height: gif.height,
      };
      closers.push(() => closeDecodedGif(gif));
    }
  }

  if (project.source.kind === "video") {
    if (!sourceUrl) throw new Error("no-source");
    video = await loadVideoElement(sourceUrl);
    closers.push(() => {
      video?.pause();
      video?.removeAttribute("src");
      video?.load();
    });
  } else if (project.source.kind === "image") {
    const source = assets[project.source.assetId];
    if (!source) throw new Error("missing-asset");
    const image = await decodeImage(source.blob, 1920);
    sourceImage = image.bitmap;
    closers.push(() => image.bitmap.close());
  } else {
    const source = assets[project.source.assetId];
    if (!source) throw new Error("missing-asset");
    sourceGif = await decodeGif(source.blob, {
      maxFrames: GIF_MAX_FRAMES,
      maxSide: 1024,
    });
    closers.push(() => sourceGif && closeDecodedGif(sourceGif));
  }

  return {
    render,
    sourceImage,
    sourceGif,
    video,
    close: () => closers.forEach((fn) => fn()),
  };
}

const cancelledExports = new Set<string>();
/** 正在跑的编码器：取消时直接终止 Worker，不等它写完 */
let activeEncoder: GifEncoderClient | null = null;

export function cancelGifExport(): void {
  const id = useWorkspace.getState().gif.exportJob?.id;
  if (id) cancelledExports.add(id);
  activeEncoder?.cancel();
  clearGifExport();
}

export async function exportGif(sourceUrl: string | null): Promise<void> {
  const state = useWorkspace.getState();
  const project = state.gif.project;
  const assets = state.gif.assets;
  if (!project || state.gif.exportJob?.status === "running") return;
  const issue = exportFrameIssue(project.timeline, project.export.fps);
  if (issue) {
    toast(issueText(issue));
    return;
  }
  const frames = exportFrameSchedule(project.timeline, project.export.fps);
  const total = frames.length;
  const jobId = uuid();
  beginGifExport(jobId, total);
  let prepared: PreparedAssets | null = null;
  try {
    prepared = await prepareAssets(project, assets, sourceUrl);
    const size = exportDimensions(project.canvas, project.export.width);
    const transparent =
      project.export.transparent &&
      project.canvas.background.kind === "transparent";
    const targetBytes = project.export.targetBytes;

    /** 按方案渲染并编码一轮；抽帧时延时按步长补偿，总时长不变 */
    const encodeWithPlan = async (
      plan: GifExportPlan,
    ): Promise<{ blob: Blob; bytes: number }> => {
      const canvas = document.createElement("canvas");
      canvas.width = plan.width;
      canvas.height = plan.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas-failed");
      const enc = new GifEncoderClient(
        {
          width: plan.width,
          height: plan.height,
          colors: plan.colors,
          loop: project.export.loop,
          transparent,
        },
        // 进度按本轮实际写入的帧数折算：降档抽帧后写入的帧比总帧少
        (done) =>
          gifExportProgress(
            Math.min(
              total,
              Math.round((done / Math.max(1, plan.frames)) * total),
            ),
          ),
      );
      activeEncoder = enc;
      try {
        for (let index = 0; index < frames.length; index += plan.frameStep) {
          if (useWorkspace.getState().gif.exportJob?.id !== jobId)
            throw new Error("cancelled");
          const frame = frames[index];
          // 压缩抽帧时合并被跳过帧的延时，末尾不足一个步长也保持总时长。
          const delay = frames
            .slice(index, index + plan.frameStep)
            .reduce((sum, item) => sum + item.delay, 0);
          let sourceFrame: CanvasImageSource | null = null;
          if (prepared?.video) {
            await seekVideo(prepared.video, frame.sourceTime);
            sourceFrame = prepared.video;
          } else if (prepared?.sourceImage) {
            sourceFrame = prepared.sourceImage;
          } else if (prepared?.sourceGif) {
            sourceFrame = gifFrameAt(
              {
                frames: prepared.sourceGif.frames,
                durations: prepared.sourceGif.durations,
                totalMs: prepared.sourceGif.totalMs,
                width: prepared.sourceGif.width,
                height: prepared.sourceGif.height,
              },
              frame.sourceTime,
              true,
            );
          }
          renderProjectFrame(ctx, {
            project,
            sourceFrame,
            // 图层时间轴按这一帧在时间轴上的真实位置算：抽帧只改每帧停留多久，
            // 不改它落在时间轴的哪一格（否则图层会被判成已结束而整段消失）
            time: frame.time,
            assets: prepared?.render ?? {},
            // 导出画布与项目画布尺寸可能不同（体积预设 / 降档），按比例缩放
            scale: plan.width / project.canvas.width,
          });
          const image = ctx.getImageData(0, 0, plan.width, plan.height);
          enc.writeFrame(image, delay);
          if (index % 2 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        return await enc.finish();
      } finally {
        if (activeEncoder === enc) activeEncoder = null;
        enc.cancel();
      }
    };

    let plan = planGifExport({
      width: size.width,
      height: size.height,
      frames: total,
      colors: project.export.colors,
      targetBytes,
    });
    let result = await encodeWithPlan(plan);
    // 超出目标体积：按上一轮方案与实测体积继续降档再试，最多两次
    for (let attempt = 0; attempt < 2; attempt++) {
      if (targetBytes <= 0 || result.bytes <= targetBytes) break;
      const next = planGifExport({
        width: plan.width,
        height: plan.height,
        frames: total,
        colors: plan.colors,
        targetBytes,
        measuredBytes: result.bytes,
      });
      if (!next.changed) break;
      plan = next;
      result = await encodeWithPlan(plan);
    }

    const assetId = `a_${uuid()}`;
    const exportAsset: GifAsset = {
      id: assetId,
      projectId: project.id,
      kind: "export",
      blob: result.blob,
      mime: "image/gif",
      width: plan.width,
      height: plan.height,
      durationMs: outputDuration(project.timeline),
      name: `${project.title || "gif"}.gif`,
    };
    const next: GifProject = {
      ...project,
      lastExportAssetId: assetId,
      lastExportBytes: result.bytes,
      lastExportWidth: plan.width,
      lastExportHeight: plan.height,
      lastExportFrames: Math.ceil(total / plan.frameStep),
      updatedAt: Date.now(),
    };
    await putGifAsset(exportAsset);
    await putGifProject(next);
    finishGifExport(next, exportAsset);
    toast(text("gif.toast.exported"));
  } catch (error) {
    if (
      (error instanceof Error && error.message === "cancelled") ||
      cancelledExports.has(jobId)
    ) {
      cancelledExports.delete(jobId);
      clearGifExport();
      toast(issueText("cancelled"));
    } else if (isQuota(error)) {
      failGifExport("quota");
      toast(issueText("quota"));
    } else {
      const issue = errorIssue(error);
      failGifExport(issue);
      toast(issueText(issue));
    }
  } finally {
    activeEncoder = null;
    prepared?.close();
  }
}

/** 导出面板关闭：清掉失败状态 */
export function clearGifExportResult(): void {
  const job = useWorkspace.getState().gif.exportJob;
  if (job && job.status !== "running") clearGifExport();
}

/** 用当前项目第一个导出素材下载；返回是否成功 */
export function downloadGifExport(): boolean {
  const state = useWorkspace.getState();
  const project = state.gif.project;
  if (!project?.lastExportAssetId) return false;
  const asset = state.gif.assets[project.lastExportAssetId];
  if (!asset) return false;
  const url = URL.createObjectURL(asset.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.title || "PicMake-GIF"}.gif`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
