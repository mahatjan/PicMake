/** 工作区共享状态（会话内，不持久化）：只放数据与 Blob / ImageRow，不存 Object URL；写入只经 actions/ 的命名迁移函数 */
import { create } from "zustand";
import type { HistoryRow, ImageRow } from "../../db/schema";
import type { PreparedGeneration } from "../../lib/generation";
import { DEFAULT_FORM, type GenForm } from "../../lib/params";
import type {
  ApiErrorKind,
  FidelityChoice,
  GenParams,
  InpaintDraft,
  InpaintEntry,
  InpaintIssue,
  InputImage,
  InputSource,
  MaskCommand,
  MaskDocument,
  PixelSize,
  SketchDocument,
  SketchOrigin,
  UploadIssue,
} from "../../lib/types";
import type { ConfirmState, GenPlan, InputNaming } from "../../lib/view-models";
import {
  FRAME_WORKFLOW_ID,
  getVideoWorkflow,
  resolutionOptions,
  VIDEO_DEFAULT_WORKFLOW,
  type VideoEntry,
  type VideoInputMode,
  type VideoRecord,
} from "../../lib/video";

/** 每次提交独立运行；请求快照与结果不会被其他任务覆盖。 */
export interface GenerationTask {
  id: string;
  prompt: string;
  model: GenParams["model"];
  run: Exclude<Run, { phase: "idle" }>;
  submittedDraft: WorkspaceState["draft"];
}

/** 多尺寸生成中的一个请求（一个比例一格）：各自的阶段、渐进预览、终稿与失败原因 */
export interface RunSlot {
  /** 这个请求的尺寸 */
  size: PixelSize;
  status: "running" | "done" | "failed";
  /** 最新的渐进预览 */
  partial: Blob | null;
  /** 终稿：舞台原位显示，全部结束后才合并保存 */
  final: Blob | null;
  /** 失败时的错误种类，舞台上显示它的标题 */
  failure: ApiErrorKind | null;
}

/** 生成生命周期；saving = 请求成功、正在写库，unsaved = 保存失败、结果留在内存（可查看、下载）。
 *  多尺寸时 slots 是每个比例的请求，partial 不用；单尺寸时 slots 为 null */
export type Run =
  | { phase: "idle" }
  | {
      phase: "generating";
      plan: GenPlan;
      partial: { blob: Blob; index: number } | null;
      slots: RunSlot[] | null;
    }
  | { phase: "saving"; prepared: PreparedGeneration }
  | { phase: "unsaved"; prepared: PreparedGeneration };

/** 画板：草图与局部重绘共用一个槽位，互斥由类型保证；opening = 局部重绘底图准备中。
 *  id 在打开时生成，异步结果回来后与当前 id 比对，不一致就丢弃 */
export type Drawing =
  | { kind: "opening"; id: string }
  | {
      kind: "sketch";
      id: string;
      doc: SketchDocument;
      cursor: number;
      /** 编辑已有附件时的原位替换目标；新建、继续历史草图为 null */
      replacesImageId: string | null;
      /** 打开的来源：弹层角落的说明文字由界面按当前语言生成 */
      origin: SketchOrigin;
      /** 打开时的快照键：撤销回这个状态视为没有修改 */
      openKey: string;
      confirming: boolean;
    }
  | {
      kind: "inpaint";
      id: string;
      entry: InpaintEntry;
      /** 实际请求底图（方向归一后）；URL 由页面从 base.blob 生成 */
      base: ImageRow;
      /** 仅发生方向归一时存在：原文件与其来源身份 */
      original?: { source: InputSource; image: ImageRow };
      /** 发生了方向归一化：弹层里提示 */
      normalized: boolean;
      doc: MaskDocument;
      cursor: number;
      /** draft-input 入口被涂选的原输入 id：确认后移除并把底图重排为图1 */
      chosenInputId: string | null;
      /** 被涂选底图的名字种类（标题与 alt） */
      naming: InputNaming;
      openKey: string;
      confirming: boolean;
      /** 就地错误（非 toast） */
      error: InpaintIssue | null;
    };

/** 只读查看选区：底图 URL 由页面从 base.blob 生成 */
export interface ViewMask {
  base: ImageRow;
  commands: MaskCommand[];
  rowId: string;
}

/** 视频表单里的一张本地图。Object URL 不进 store */
export interface VideoImageDraft {
  id: string;
  blob: Blob;
  name: string;
}

/** 视频表单草稿：只活在本次会话，刷新即丢 */
export interface VideoDraft {
  /** null = 表单关闭 */
  entry: VideoEntry | null;
  refWorkflowId: string;
  customWorkflowId: string;
  customInput: VideoInputMode;
  prompt: string;
  duration: string;
  resolution: string;
  /** 各工作流上次选过的分辨率 */
  resolutions: Record<string, string>;
  /** 各工作流手填的 seed；没有这个 key 表示还没改过，界面显示默认值 */
  seeds: Record<string, string>;
  customResolution: string;
  refs: VideoImageDraft[];
  frames: { first: VideoImageDraft | null; last: VideoImageDraft | null };
}

export interface WorkspaceState {
  history: {
    /** 只由 liveQuery 订阅（flows/history-sync）写入；null 表示尚未加载 */
    rows: HistoryRow[] | null;
    /** 刚保存的那次生成：列表回推前用它过渡显示；展示它期间沿用同一组图片 URL，保存前后不闪空。下次开始生成时清空 */
    recent: PreparedGeneration | null;
  };
  /** 并行生成任务，最新提交在前；未保存结果保留到用户确认放弃。 */
  tasks: GenerationTask[];
  /** 一次提交的草稿：文字、参数与输入图；局部重绘时底图恒为 inputs[0] */
  draft: {
    form: GenForm;
    inputs: InputImage[];
    inpaint: InpaintDraft | null;
    /** 建议尺寸是否已接受：仅对当前底图与目标尺寸有效 */
    sizeAccepted: boolean;
    inputFidelity: FidelityChoice;
    /** 自上次初始化或提交以来用户是否改过草稿；保存成功时据此决定要不要复位草稿 */
    dirty: boolean;
    /** 正在读取的上传批次；非 null 即读取中 */
    readId: string | null;
    /** 上传读取阶段的提示；文案由界面按当前语言生成 */
    uploadIssues: UploadIssue[];
  };
  nav: {
    selectedId: string | null;
    /** "编辑此图"进入草稿前展示的记录，供"返回结果" */
    returnId: string | null;
    /** 最近保存成功的记录：与展示记录一致时底栏为 complete 态 */
    lastDoneId: string | null;
  };
  /** 草图或局部重绘画板；null = 没有打开 */
  drawing: Drawing | null;
  view: {
    barMode: "mini" | "full";
    /** 聚焦描述框的意图计数：变化时由页面聚焦 */
    focusSeq: number;
    previewId: string | null;
    /** 轮播当前序号 */
    focusIdx: number | null;
    lightboxId: string | null;
    drawerOpen: boolean;
    settingsOpen: boolean;
    /** 视频工作台盖住舞台和创作条 */
    playgroundOpen: boolean;
    viewMask: ViewMask | null;
  };
  /** 视频工作台：记录由 liveQuery 回推；草稿与提交锁只在会话内 */
  video: {
    rows: VideoRecord[] | null;
    submitting: boolean;
    previewId: string | null;
    draft: VideoDraft;
  };
  confirm: ConfirmState | null;
}

export const initialWorkspace = (): WorkspaceState => {
  const resolution = resolutionOptions({
    entry: "ref",
    workflowId: VIDEO_DEFAULT_WORKFLOW,
  })[0];
  return {
    history: { rows: null, recent: null },
    tasks: [],
    draft: {
      form: DEFAULT_FORM,
      inputs: [],
      inpaint: null,
      sizeAccepted: false,
      inputFidelity: "auto",
      dirty: false,
      readId: null,
      uploadIssues: [],
    },
    nav: { selectedId: null, returnId: null, lastDoneId: null },
    drawing: null,
    view: {
      barMode: "mini",
      focusSeq: 0,
      previewId: null,
      focusIdx: null,
      lightboxId: null,
      drawerOpen: false,
      settingsOpen: false,
      playgroundOpen: false,
      viewMask: null,
    },
    video: {
      rows: null,
      submitting: false,
      previewId: null,
      draft: {
        entry: null,
        refWorkflowId: VIDEO_DEFAULT_WORKFLOW,
        customWorkflowId: "",
        customInput: "refs",
        prompt: "",
        duration: "5",
        resolution,
        resolutions: {},
        seeds: {},
        customResolution:
          getVideoWorkflow(FRAME_WORKFLOW_ID)?.defaultResolution ?? resolution,
        refs: [],
        frames: { first: null, last: null },
      },
    },
    confirm: null,
  };
};

export const useWorkspace = create<WorkspaceState>()(initialWorkspace);
