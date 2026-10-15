/** IndexedDB：图片 Blob 与生成历史 */
import Dexie, { type EntityTable } from "dexie";
import type {
  GenParams,
  InputSource,
  FidelityChoice,
  SketchDocument,
  InpaintHistory,
} from "../lib/types";
import type { VideoRecord } from "../lib/video";

export interface ImageRow {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  format: string;
  /** 草图命令文档；可选字段，旧行按普通图片处理 */
  sketch?: SketchDocument;
  /** mask 选区文档；同一行不能同时有 sketch 与 mask */
  mask?: import("../lib/types").MaskDocument;
}

export interface HistoryRow {
  id: string;
  prompt: string;
  params: GenParams;
  usage: Record<string, unknown> | null;
  /** 多尺寸记录（params.sizes 存在）：每个请求各自的原始 usage，顺序与 imageIds 一致，不合计、不换算；此时 usage 为 null */
  usages?: Array<Record<string, unknown> | null>;
  imageIds: string[];
  createdAt: number;
  inputSources?: InputSource[];
  /** 保真度选择：auto = 未发送（旧记录为 low/high） */
  inputFidelity?: FidelityChoice;
  /** 编辑/参考图生成的原始描述（链路取最初） */
  originPrompt?: string;
  /** 收藏标记：缺省视为未收藏 */
  starred?: boolean;
  /** 局部重绘信息：存在即表示局部重绘 */
  inpaint?: InpaintHistory;
  durationMs: number;
}

export type VideoRow = VideoRecord;

export const db = new Dexie("PicMake") as Dexie & {
  images: EntityTable<ImageRow, "id">;
  history: EntityTable<HistoryRow, "id">;
  videos: EntityTable<VideoRow, "id">;
};

db.version(1).stores({
  images: "id",
  history: "id, createdAt",
});

db.version(2).stores({
  images: "id",
  history: "id, createdAt",
  videos: "id, createdAt, status",
});

/** 启动时申请持久化存储，降低浏览器自动清理 IndexedDB 的风险 */
export async function ensurePersistentStorage(): Promise<void> {
  try {
    await navigator.storage.persist();
  } catch {
    /* 不支持则忽略 */
  }
}
