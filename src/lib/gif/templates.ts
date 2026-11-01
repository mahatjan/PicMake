/** 模板：一键套用的一组参数（时间轴 / 画布 / 导出）。纯函数。 */
import { canvasForAspect, sampleEvery } from "./timeline";
import { DEFAULT_FILTER } from "./filters";
import type {
  GifCanvas,
  GifExportSettings,
  GifProject,
  GifTimeline,
} from "./types";

export type GifTemplateId =
  "boomerang" | "half" | "mono" | "square" | "transparent" | "small";

export interface GifTemplatePatch {
  timeline?: Partial<GifTimeline>;
  canvas?: Partial<GifCanvas>;
  export?: Partial<GifExportSettings>;
}

export interface GifTemplate {
  id: GifTemplateId;
  patch: (project: GifProject) => GifTemplatePatch;
}

export const GIF_TEMPLATES: GifTemplate[] = [
  {
    id: "boomerang",
    patch: () => ({ timeline: { direction: "boomerang" } }),
  },
  {
    id: "half",
    patch: (project) => ({
      timeline: { selected: sampleEvery(project.timeline, 2) },
    }),
  },
  {
    id: "mono",
    patch: () => ({
      canvas: { filter: { ...DEFAULT_FILTER, preset: "mono" } },
      export: { colors: 64 },
    }),
  },
  {
    id: "square",
    patch: (project) => ({
      canvas: canvasForAspect(
        "1:1",
        project.source.width,
        project.source.height,
      ),
    }),
  },
  {
    id: "transparent",
    patch: () => ({
      canvas: { background: { kind: "transparent" } },
      export: { transparent: true },
    }),
  },
  {
    id: "small",
    patch: () => ({ export: { width: 240, colors: 128 } }),
  },
];
