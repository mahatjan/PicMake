/** GIF 工作台迁移函数：项目文档、素材、导入/导出任务、撤销重做；不做 IO。 */
import {
  clampLayer,
  clampLayerInCanvas,
  fitLayerWidth,
  translateDoodle,
  type LayerAssetSize,
} from "../../../lib/gif/layers";
import {
  compactSelection,
  clampFps,
  invertSelected,
  normalizeTimeline,
  outputDuration,
  sampleEvery,
  sourceFrameCount,
  toggleSelectedFrame,
} from "../../../lib/gif/timeline";
import {
  migrateGifProject,
  syncExportWithCanvas,
} from "../../../lib/gif/project";
import { GIF_TEMPLATES, type GifTemplateId } from "../../../lib/gif/templates";
import { uuid } from "../../../lib/uuid";
import type {
  GifAsset,
  GifIssue,
  GifLayer,
  GifProject,
} from "../../../lib/gif/types";
import {
  GIF_MAX_CANVAS_SIDE,
  GIF_MAX_EXPORT_SIDE,
  GIF_MAX_LAYERS,
} from "../../../lib/gif/types";
import { set } from "./internal";

const HISTORY_LIMIT = 30;
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

function projectDuration(project: GifProject): number {
  return Math.max(100, outputDuration(project.timeline));
}

/** 图层素材尺寸：图片 / GIF 图层的盒子按素材原始比例算 */
function layerAssetSize(
  layer: GifLayer,
  assets: Record<string, GifAsset>,
): LayerAssetSize | null {
  if (layer.kind !== "image" && layer.kind !== "gif") return null;
  const asset = assets[layer.assetId];
  if (!asset || asset.width <= 0 || asset.height <= 0) return null;
  return { width: asset.width, height: asset.height };
}

/** 图层卡在画布边界内：画板外的图层被裁掉，抓不回来 */
function clampLayers(
  layers: readonly GifLayer[],
  canvas: GifProject["canvas"],
  assets: Record<string, GifAsset>,
): GifLayer[] {
  return layers.map((layer) =>
    clampLayerInCanvas(layer, canvas, layerAssetSize(layer, assets)),
  );
}

/** 项目一改，上一次导出就不再对应当前版本：清掉导出指针（素材仍留在库里）。
 *  不清的话导出面板会一直显示旧结果、下载按钮也会下载到改之前的 GIF。 */
function withoutExportPointer(project: GifProject): GifProject {
  if (!project.lastExportAssetId) return project;
  return {
    ...project,
    lastExportAssetId: undefined,
    lastExportBytes: undefined,
    lastExportWidth: undefined,
    lastExportHeight: undefined,
    lastExportFrames: undefined,
  };
}

function withHistory(
  gif: WorkspaceStateGif,
  project: GifProject,
  record: boolean,
): WorkspaceStateGif {
  const past = record
    ? [...gif.history.past, gif.project].filter(Boolean).slice(-HISTORY_LIMIT)
    : gif.history.past;
  return {
    ...gif,
    project: withoutExportPointer(project),
    dirty: true,
    history: { past, future: record ? [] : gif.history.future },
  } as WorkspaceStateGif;
}

type WorkspaceStateGif = {
  rows: GifProject[] | null;
  project: GifProject | null;
  assets: Record<string, GifAsset>;
  importJob: {
    id: string;
    status: "reading" | "error";
    name: string;
    progress: number;
    error: GifIssue | null;
  } | null;
  exportJob: {
    id: string;
    status: "running" | "error";
    progress: number;
    total: number;
    error: GifIssue | null;
  } | null;
  saving: boolean;
  dirty: boolean;
  history: { past: GifProject[]; future: GifProject[] };
};

/* ── 打开/关闭 ── */

export const gifProjectsLoaded = (rows: GifProject[]) =>
  set((s) => ({ gif: { ...s.gif, rows } }));

export const openGif = () =>
  set((s) => ({
    view: {
      ...s.view,
      gifOpen: true,
      playgroundOpen: false,
      lightboxId: null,
      focusIdx: null,
      previewId: null,
      drawerOpen: false,
      settingsOpen: false,
      viewMask: null,
    },
  }));

export const closeGif = () =>
  set((s) => ({ view: { ...s.view, gifOpen: false } }));

export const closeGifProject = () =>
  set((s) => ({
    gif: {
      ...s.gif,
      project: null,
      assets: {},
      importJob: null,
      exportJob: null,
      dirty: false,
      history: { past: [], future: [] },
    },
  }));

export const loadGifProject = (
  project: GifProject,
  assets: Record<string, GifAsset>,
) =>
  set((s) => ({
    view: { ...s.view, gifOpen: true },
    gif: {
      ...s.gif,
      project: migrateGifProject(project),
      assets,
      dirty: false,
      importJob: null,
      exportJob: null,
      history: { past: [], future: [] },
    },
  }));

export const addGifAsset = (asset: GifAsset) =>
  set((s) => ({
    gif: { ...s.gif, assets: { ...s.gif.assets, [asset.id]: asset } },
  }));

export const removeGifAsset = (id: string) =>
  set((s) => {
    const assets = { ...s.gif.assets };
    delete assets[id];
    return { gif: { ...s.gif, assets } };
  });

/** 缩略图按字节存：Safari 的 IndexedDB 存不了 Blob */
export const setGifThumb = (thumbBytes: Uint8Array<ArrayBuffer>) =>
  set((s) => {
    if (!s.gif.project) return s;
    return {
      gif: { ...s.gif, project: { ...s.gif.project, thumbBytes } },
    };
  });

/* ── 导入任务 ── */

export const beginGifImport = (id: string, name: string) =>
  set((s) => ({
    gif: {
      ...s.gif,
      importJob: { id, status: "reading", name, progress: 0, error: null },
    },
  }));

export const gifImportProgress = (progress: number) =>
  set((s) =>
    s.gif.importJob
      ? {
          gif: {
            ...s.gif,
            importJob: {
              ...s.gif.importJob,
              progress: clamp(progress, 0, 1),
            },
          },
        }
      : s,
  );

export const failGifImport = (issue: GifIssue) =>
  set((s) =>
    s.gif.importJob
      ? {
          gif: {
            ...s.gif,
            importJob: { ...s.gif.importJob, status: "error", error: issue },
          },
        }
      : s,
  );

export const clearGifImport = () =>
  set((s) => ({ gif: { ...s.gif, importJob: null } }));

/* ── 项目编辑 ── */

export const setGifTitle = (title: string) =>
  set((s) => {
    if (!s.gif.project) return s;
    const next = {
      ...s.gif.project,
      title: title.slice(0, 80),
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });

/** fps/裁剪区间变化时清空手动选帧；selected 显式传入则保留 */
export const setGifTimeline = (
  patch: Partial<GifProject["timeline"]>,
  record = true,
) =>
  set((s) => {
    if (!s.gif.project) return s;
    const resetSelection =
      patch.selected === undefined &&
      (patch.fps !== undefined ||
        patch.trimStart !== undefined ||
        patch.trimEnd !== undefined);
    const nextTimeline = normalizeTimeline(
      {
        ...s.gif.project.timeline,
        ...patch,
        ...(resetSelection ? { selected: null } : {}),
      },
      s.gif.project.source.durationMs,
    );
    const duration = Math.max(100, outputDuration(nextTimeline));
    const next: GifProject = {
      ...s.gif.project,
      timeline: nextTimeline,
      layers: s.gif.project.layers.map((layer) => clampLayer(layer, duration)),
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, record) };
  });

export const setGifSelectedFrames = (selected: number[]) =>
  set((s) => {
    if (!s.gif.project) return s;
    const count = sourceFrameCount(s.gif.project.timeline);
    const clean = [...new Set(selected)]
      .filter((index) => index >= 0 && index < count)
      .sort((a, b) => a - b);
    const next = {
      ...s.gif.project,
      timeline: {
        ...s.gif.project.timeline,
        selected: compactSelection(clean, count),
      },
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });

export const toggleGifFrame = (index: number) =>
  set((s) => {
    if (!s.gif.project) return s;
    const selected = toggleSelectedFrame(s.gif.project.timeline, index);
    const count = sourceFrameCount(s.gif.project.timeline);
    const next = {
      ...s.gif.project,
      timeline: {
        ...s.gif.project.timeline,
        selected: compactSelection(selected, count),
      },
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });

export const selectAllGifFrames = () =>
  set((s) => {
    if (!s.gif.project) return s;
    return {
      gif: withHistory(
        s.gif,
        {
          ...s.gif.project,
          timeline: { ...s.gif.project.timeline, selected: null },
          updatedAt: Date.now(),
        },
        true,
      ),
    };
  });

export const clearGifFrames = () =>
  set((s) => {
    if (!s.gif.project) return s;
    return {
      gif: withHistory(
        s.gif,
        {
          ...s.gif.project,
          timeline: { ...s.gif.project.timeline, selected: [] },
          updatedAt: Date.now(),
        },
        true,
      ),
    };
  });

export const invertGifFrames = () =>
  set((s) => {
    if (!s.gif.project) return s;
    const selected = invertSelected(s.gif.project.timeline);
    const count = sourceFrameCount(s.gif.project.timeline);
    return {
      gif: withHistory(
        s.gif,
        {
          ...s.gif.project,
          timeline: {
            ...s.gif.project.timeline,
            selected: compactSelection(selected, count),
          },
          updatedAt: Date.now(),
        },
        true,
      ),
    };
  });

export const sampleGifFrames = (every: number) =>
  set((s) => {
    if (!s.gif.project) return s;
    const selected = sampleEvery(s.gif.project.timeline, every);
    const count = sourceFrameCount(s.gif.project.timeline);
    return {
      gif: withHistory(
        s.gif,
        {
          ...s.gif.project,
          timeline: {
            ...s.gif.project.timeline,
            selected: compactSelection(selected, count),
          },
          updatedAt: Date.now(),
        },
        true,
      ),
    };
  });

export const setGifCanvas = (
  patch: Partial<GifProject["canvas"]>,
  record = true,
) =>
  set((s) => {
    if (!s.gif.project) return s;
    const width = clamp(
      Math.round(patch.width ?? s.gif.project.canvas.width),
      2,
      GIF_MAX_CANVAS_SIDE,
    );
    const height = clamp(
      Math.round(patch.height ?? s.gif.project.canvas.height),
      2,
      GIF_MAX_CANVAS_SIDE,
    );
    const next: GifProject = {
      ...s.gif.project,
      canvas: {
        ...s.gif.project.canvas,
        ...patch,
        filter: {
          ...s.gif.project.canvas.filter,
          ...(patch.filter ?? {}),
        },
        width,
        height,
      },
      // 画布换了尺寸：图层跟着卡回边界，别留在画布外面
      layers: clampLayers(
        s.gif.project.layers,
        { ...s.gif.project.canvas, ...patch, width, height },
        s.gif.assets,
      ),
      updatedAt: Date.now(),
    };
    const synced = syncExportWithCanvas(next);
    if (
      patch.background?.kind === "transparent" &&
      synced.canvas.background.kind === "transparent"
    )
      synced.export = { ...synced.export, transparent: true };
    return { gif: withHistory(s.gif, synced, record) };
  });

export const setGifExport = (
  patch: Partial<GifProject["export"]>,
  record = true,
) =>
  set((s) => {
    if (!s.gif.project) return s;
    const base = s.gif.project.export;
    const next: GifProject = {
      ...s.gif.project,
      export: {
        ...base,
        ...patch,
        fps: clampFps(patch.fps ?? base.fps),
        width: clamp(
          Math.round(patch.width ?? base.width),
          16,
          GIF_MAX_EXPORT_SIDE,
        ),
        colors: clamp(Math.round(patch.colors ?? base.colors), 2, 256),
        loop: clamp(Math.round(patch.loop ?? base.loop), 0, 99),
        targetBytes: clamp(
          Math.round(patch.targetBytes ?? base.targetBytes),
          0,
          100 * 1024 * 1024,
        ),
      },
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, record) };
  });

/** 追加一笔涂鸦（归一化画布坐标） */
export const appendGifStroke = (layerId: string, points: number[]) =>
  set((s) => {
    if (!s.gif.project) return s;
    const layers = s.gif.project.layers;
    const index = layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) return s;
    const layer = layers[index];
    if (layer.kind !== "doodle" || points.length < 2) return s;
    const nextLayers = [...layers];
    nextLayers[index] = { ...layer, strokes: [...layer.strokes, points] };
    const project = {
      ...s.gif.project,
      layers: nextLayers,
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, project, true) };
  });

/** 拖动涂鸦笔迹：笔迹是画布绝对坐标，平移直接改笔迹 */
export const moveGifDoodle = (id: string, dx: number, dy: number) =>
  set((s) => {
    if (!s.gif.project) return s;
    const layers = s.gif.project.layers;
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return s;
    const layer = layers[index];
    if (layer.kind !== "doodle") return s;
    const moved = translateDoodle(layer, dx, dy);
    if (moved === layer) return s;
    const nextLayers = [...layers];
    nextLayers[index] = moved;
    const project = {
      ...s.gif.project,
      layers: nextLayers,
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, project, false) };
  });

/** 套用模板：一键改时间轴 / 画布 / 导出参数 */
export const applyGifTemplate = (id: GifTemplateId) =>
  set((s) => {
    if (!s.gif.project) return s;
    const project = s.gif.project;
    const template = GIF_TEMPLATES.find((item) => item.id === id);
    if (!template) return s;
    const patch = template.patch(project);
    let next: GifProject = { ...project };
    if (patch.timeline) {
      const timeline = normalizeTimeline(
        { ...project.timeline, ...patch.timeline },
        project.source.durationMs,
      );
      const duration = Math.max(100, outputDuration(timeline));
      next = {
        ...next,
        timeline,
        layers: project.layers.map((layer) => clampLayer(layer, duration)),
      };
    }
    if (patch.canvas)
      next = { ...next, canvas: { ...next.canvas, ...patch.canvas } };
    if (patch.export)
      next = { ...next, export: { ...next.export, ...patch.export } };
    // 模板可能改了画布尺寸：图层跟着卡回边界
    next.layers = clampLayers(next.layers, next.canvas, s.gif.assets);
    next.updatedAt = Date.now();
    return { gif: withHistory(s.gif, next, true) };
  });

export const setGifLayers = (layers: GifLayer[], record = true) =>
  set((s) => {
    if (!s.gif.project) return s;
    const next = { ...s.gif.project, layers, updatedAt: Date.now() };
    return { gif: withHistory(s.gif, next, record) };
  });

export const addGifLayer = (layer: GifLayer): boolean => {
  let added = false;
  set((s) => {
    if (!s.gif.project || s.gif.project.layers.length >= GIF_MAX_LAYERS)
      return s;
    added = true;
    const project = s.gif.project;
    const asset = layerAssetSize(layer, s.gif.assets);
    // 新图层整块留在画布里：按素材比例收窄宽度，再把位置卡进边界
    const fitted = {
      ...layer,
      width: fitLayerWidth(layer.width, project.canvas, asset),
    } as GifLayer;
    const next = {
      ...project,
      layers: [
        ...project.layers,
        clampLayerInCanvas(fitted, project.canvas, asset),
      ],
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });
  return added;
};

export const patchGifLayer = (
  id: string,
  patch: Partial<GifLayer>,
  record = true,
) =>
  set((s) => {
    if (!s.gif.project) return s;
    const duration = projectDuration(s.gif.project);
    const canvas = s.gif.project.canvas;
    const layers = s.gif.project.layers.map((layer) => {
      if (layer.id !== id) return layer;
      const patched = clampLayer({ ...layer, ...patch } as GifLayer, duration);
      return clampLayerInCanvas(
        patched,
        canvas,
        layerAssetSize(patched, s.gif.assets),
      );
    });
    const next = { ...s.gif.project, layers, updatedAt: Date.now() };
    return { gif: withHistory(s.gif, next, record) };
  });

export const removeGifLayer = (id: string) =>
  set((s) => {
    if (!s.gif.project) return s;
    const next = {
      ...s.gif.project,
      layers: s.gif.project.layers.filter((layer) => layer.id !== id),
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });

export const moveGifLayer = (id: string, delta: number) =>
  set((s) => {
    if (!s.gif.project) return s;
    const layers = [...s.gif.project.layers];
    const index = layers.findIndex((layer) => layer.id === id);
    if (index < 0) return s;
    const target = clamp(index + delta, 0, layers.length - 1);
    if (target === index) return s;
    const [item] = layers.splice(index, 1);
    layers.splice(target, 0, item);
    const next = { ...s.gif.project, layers, updatedAt: Date.now() };
    return { gif: withHistory(s.gif, next, true) };
  });

export const duplicateGifLayer = (id: string) =>
  set((s) => {
    if (!s.gif.project) return s;
    const source = s.gif.project.layers.find((layer) => layer.id === id);
    if (!source || s.gif.project.layers.length >= GIF_MAX_LAYERS) return s;
    const copy = {
      ...source,
      id: uuid(),
      name: source.name ? `${source.name} 2` : "",
      x: clamp(source.x + 0.03, -0.5, 1.5),
      y: clamp(source.y + 0.03, -0.5, 1.5),
    } as GifLayer;
    const next = {
      ...s.gif.project,
      layers: [
        ...s.gif.project.layers,
        clampLayerInCanvas(
          copy,
          s.gif.project.canvas,
          layerAssetSize(copy, s.gif.assets),
        ),
      ],
      updatedAt: Date.now(),
    };
    return { gif: withHistory(s.gif, next, true) };
  });

/** 拖动/滑块开始：把当前文档压入历史；后续 live 更新不再逐次记历史 */
export const beginGifEdit = () =>
  set((s) => {
    if (!s.gif.project) return s;
    return {
      gif: {
        ...s.gif,
        history: {
          past: [...s.gif.history.past, s.gif.project].slice(-HISTORY_LIMIT),
          future: [],
        },
      },
    };
  });

export const endGifEdit = () => {
  // 只标记有改动；历史在 beginGifEdit 已记录
  set((s) => (s.gif.project ? { gif: { ...s.gif, dirty: true } } : s));
};

export const undoGif = () =>
  set((s) => {
    const past = s.gif.history.past;
    if (!s.gif.project || !past.length) return s;
    const previous = past[past.length - 1];
    return {
      gif: {
        ...s.gif,
        project: previous,
        dirty: true,
        history: {
          past: past.slice(0, -1),
          future: [s.gif.project, ...s.gif.history.future].slice(
            0,
            HISTORY_LIMIT,
          ),
        },
      },
    };
  });

export const redoGif = () =>
  set((s) => {
    const future = s.gif.history.future;
    if (!s.gif.project || !future.length) return s;
    const next = future[0];
    return {
      gif: {
        ...s.gif,
        project: next,
        dirty: true,
        history: {
          past: [...s.gif.history.past, s.gif.project].slice(-HISTORY_LIMIT),
          future: future.slice(1),
        },
      },
    };
  });

/* ── 保存/导出任务 ── */

export const gifSaving = (saving: boolean) =>
  set((s) => ({ gif: { ...s.gif, saving } }));

export const gifSaved = (project: GifProject) =>
  set((s) => ({
    gif: {
      ...s.gif,
      project,
      dirty: false,
      saving: false,
    },
  }));

export const beginGifExport = (id: string, total: number) =>
  set((s) => ({
    gif: {
      ...s.gif,
      exportJob: { id, status: "running", progress: 0, total, error: null },
    },
  }));

export const gifExportProgress = (done: number) =>
  set((s) =>
    s.gif.exportJob
      ? {
          gif: {
            ...s.gif,
            exportJob: {
              ...s.gif.exportJob,
              progress: clamp(done, 0, s.gif.exportJob.total || done),
            },
          },
        }
      : s,
  );

export const failGifExport = (issue: GifIssue) =>
  set((s) => ({
    gif: {
      ...s.gif,
      exportJob: s.gif.exportJob
        ? { ...s.gif.exportJob, status: "error", error: issue }
        : { id: "", status: "error", progress: 0, total: 0, error: issue },
    },
  }));

export const finishGifExport = (project: GifProject, asset: GifAsset) =>
  set((s) => ({
    gif: {
      ...s.gif,
      project,
      assets: { ...s.gif.assets, [asset.id]: asset },
      exportJob: null,
      dirty: false,
    },
  }));

export const clearGifExport = () =>
  set((s) => ({ gif: { ...s.gif, exportJob: null } }));

/** 导出结果页回到设置：清掉上次导出指针，但保留素材 */
export const resetGifExport = () =>
  set((s) => {
    if (!s.gif.project) return s;
    return {
      gif: {
        ...s.gif,
        exportJob: null,
        project: {
          ...s.gif.project,
          lastExportAssetId: undefined,
          lastExportBytes: undefined,
          lastExportWidth: undefined,
          lastExportHeight: undefined,
          lastExportFrames: undefined,
        },
      },
    };
  });

/** 从已有素材创建新项目（导入 flow 用）：直接把项目放进编辑器 */
export const startGifProject = (
  project: GifProject,
  assets: Record<string, GifAsset>,
) =>
  set((s) => ({
    view: {
      ...s.view,
      gifOpen: true,
      playgroundOpen: false,
      lightboxId: null,
      focusIdx: null,
      previewId: null,
      drawerOpen: false,
      settingsOpen: false,
      viewMask: null,
    },
    gif: {
      ...s.gif,
      project,
      assets,
      importJob: null,
      exportJob: null,
      saving: false,
      dirty: false,
      history: { past: [], future: [] },
    },
  }));
