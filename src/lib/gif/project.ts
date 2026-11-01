/** GIF 项目工厂与派生值：只依赖 lib 内的类型/时间轴。 */
import { fitCanvasForSource } from "./timeline";
import { DEFAULT_FILTER } from "./filters";
import type {
  GifCanvas,
  GifExportSettings,
  GifProject,
  GifSource,
} from "./types";
import {
  GIF_DEFAULT_COLORS,
  GIF_DEFAULT_EXPORT_WIDTH,
  GIF_DEFAULT_FPS,
  GIF_DEFAULT_LOOP,
  GIF_DEFAULT_TITLE,
  GIF_MAX_SOURCE_MS,
  GIF_MAX_TEXT_STROKE,
} from "./types";

export function defaultCanvas(
  sourceWidth: number,
  sourceHeight: number,
): GifCanvas {
  const size = fitCanvasForSource(sourceWidth, sourceHeight);
  return {
    ...size,
    fit: "contain",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    rotate: 0,
    flipX: false,
    flipY: false,
    background: { kind: "solid", color: "#000000" },
    filter: { ...DEFAULT_FILTER },
  };
}

export function defaultExportSettings(canvas: GifCanvas): GifExportSettings {
  return {
    width: Math.min(GIF_DEFAULT_EXPORT_WIDTH, canvas.width),
    fps: GIF_DEFAULT_FPS,
    colors: GIF_DEFAULT_COLORS,
    loop: GIF_DEFAULT_LOOP,
    transparent: canvas.background.kind === "transparent",
    targetBytes: 0,
  };
}

export function createGifProject(opts: {
  source: GifSource;
  title?: string;
  now?: number;
}): GifProject {
  const now = opts.now ?? Date.now();
  const duration = Math.min(
    GIF_MAX_SOURCE_MS,
    Math.max(100, Math.round(opts.source.durationMs)),
  );
  const canvas = defaultCanvas(opts.source.width, opts.source.height);
  return {
    id: `g_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: opts.title?.trim() || GIF_DEFAULT_TITLE,
    source: { ...opts.source, durationMs: duration },
    canvas,
    timeline: {
      fps: GIF_DEFAULT_FPS,
      trimStart: 0,
      trimEnd: duration,
      speed: 1,
      direction: "forward",
      loop: GIF_DEFAULT_LOOP,
      selected: null,
    },
    layers: [],
    export: defaultExportSettings(canvas),
    createdAt: now,
    updatedAt: now,
    version: 2,
  };
}

/** 老项目（v1）的文字描边宽度按画布宽度占比算，中文小字一加描边笔画就连成一块；
 *  v2 改成按字号占比，换算过来并压在安全上限内。 */
export function migrateGifProject(project: GifProject): GifProject {
  if (project.version >= 2) return project;
  const layers = project.layers.map((layer) => {
    if (layer.kind !== "text" || layer.strokeWidth <= 0) return layer;
    const fontSize = Math.max(0.01, layer.fontSize);
    return {
      ...layer,
      strokeWidth: Math.min(layer.strokeWidth / fontSize, GIF_MAX_TEXT_STROKE),
    };
  });
  return { ...project, layers, version: 2 };
}

/** 输出尺寸（导出面板的实时预估也会用） */
export function projectOutputSize(project: GifProject): {
  width: number;
  height: number;
} {
  const width = Math.max(16, Math.round(project.export.width));
  const ratio = project.canvas.height / Math.max(1, project.canvas.width);
  return {
    width,
    height: Math.max(16, Math.round(width * ratio)),
  };
}

/** 把画布比例/尺寸变更同步到导出宽度上限 */
export function syncExportWithCanvas(project: GifProject): GifProject {
  const maxWidth = Math.min(480, project.canvas.width);
  return {
    ...project,
    export: {
      ...project.export,
      width: Math.min(project.export.width, maxWidth),
      transparent:
        project.canvas.background.kind === "transparent"
          ? project.export.transparent
          : false,
    },
  };
}
