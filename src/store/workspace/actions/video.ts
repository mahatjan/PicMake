/** 视频工作台迁移函数：一次 set 写完，不碰 IndexedDB */
import {
  FRAME_WORKFLOW_ID,
  getVideoWorkflow,
  pickResolution,
  refWorkflows,
  resolutionOptions,
  VIDEO_DEFAULT_WORKFLOW,
  VIDEO_MAX_REFS,
  type VideoEntry,
  type VideoInputMode,
  type VideoRecord,
} from "../../../lib/video";
import { type VideoDraft, type VideoImageDraft } from "../index";
import { set } from "./internal";

function refResolution(draft: VideoDraft, workflowId: string): string {
  const workflow = getVideoWorkflow(workflowId);
  return pickResolution({
    options: resolutionOptions({ entry: "ref", workflowId }),
    cached: draft.resolutions[workflowId],
    current: draft.resolution,
    preferred: workflow?.defaultResolution,
  });
}

function seedKey(draft: VideoDraft): string {
  if (draft.entry === "custom") return draft.customWorkflowId.trim();
  if (draft.entry === "frames") return FRAME_WORKFLOW_ID;
  return draft.refWorkflowId;
}

export const videosLoaded = (rows: VideoRecord[]) =>
  set((s) => ({ video: { ...s.video, rows } }));

export const openPlayground = () =>
  set((s) => ({
    view: {
      ...s.view,
      playgroundOpen: true,
      lightboxId: null,
      focusIdx: null,
      previewId: null,
      drawerOpen: false,
    },
  }));

export const closePlayground = () =>
  set((s) => ({
    view: { ...s.view, playgroundOpen: false },
    video: {
      ...s.video,
      previewId: null,
      draft: { ...s.video.draft, entry: null },
    },
  }));

export const openVideoEntry = (entry: VideoEntry) =>
  set((s) => {
    const draft = s.video.draft;
    if (entry === "frames") {
      const options = resolutionOptions({
        entry: "frames",
        workflowId: FRAME_WORKFLOW_ID,
      });
      const resolution = pickResolution({
        options,
        cached: draft.resolutions[FRAME_WORKFLOW_ID],
        current: draft.resolution,
        preferred: getVideoWorkflow(FRAME_WORKFLOW_ID)?.defaultResolution,
      });
      return {
        video: {
          ...s.video,
          previewId: null,
          draft: { ...draft, entry, resolution },
        },
      };
    }
    if (entry === "custom") {
      const options = resolutionOptions({ entry: "custom", workflowId: "" });
      const resolution = options.includes(draft.customResolution)
        ? draft.customResolution
        : (options[0] ?? draft.resolution);
      return {
        video: {
          ...s.video,
          previewId: null,
          draft: { ...draft, entry, resolution, customResolution: resolution },
        },
      };
    }
    const known = refWorkflows().some(
      (item) => item.id === draft.refWorkflowId,
    );
    const refWorkflowId = known ? draft.refWorkflowId : VIDEO_DEFAULT_WORKFLOW;
    return {
      video: {
        ...s.video,
        previewId: null,
        draft: {
          ...draft,
          entry: "ref",
          refWorkflowId,
          resolution: refResolution(draft, refWorkflowId),
        },
      },
    };
  });

export const closeVideoEntry = () =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, entry: null } },
  }));

export const setVideoPrompt = (prompt: string) =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, prompt } },
  }));

export const setVideoDuration = (duration: string) =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, duration } },
  }));

export const setCustomWorkflowId = (customWorkflowId: string) =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, customWorkflowId } },
  }));

export const setCustomInput = (customInput: VideoInputMode) =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, customInput } },
  }));

export const setVideoWorkflow = (id: string) =>
  set((s) => {
    if (!refWorkflows().some((item) => item.id === id)) return s;
    const draft = s.video.draft;
    return {
      video: {
        ...s.video,
        draft: {
          ...draft,
          refWorkflowId: id,
          resolution: refResolution(draft, id),
          resolutions: {
            ...draft.resolutions,
            [draft.refWorkflowId]: draft.resolution,
          },
        },
      },
    };
  });

export const setVideoResolution = (resolution: string) =>
  set((s) => {
    const draft = s.video.draft;
    if (draft.entry === "custom") {
      return {
        video: {
          ...s.video,
          draft: { ...draft, resolution, customResolution: resolution },
        },
      };
    }
    const key =
      draft.entry === "frames" ? FRAME_WORKFLOW_ID : draft.refWorkflowId;
    return {
      video: {
        ...s.video,
        draft: {
          ...draft,
          resolution,
          resolutions: { ...draft.resolutions, [key]: resolution },
        },
      },
    };
  });

export const setVideoSeed = (seed: string) =>
  set((s) => {
    const key = seedKey(s.video.draft);
    return {
      video: {
        ...s.video,
        draft: {
          ...s.video.draft,
          seeds: { ...s.video.draft.seeds, [key]: seed },
        },
      },
    };
  });

/** 返回因超过张数上限没放进去的数量 */
export function addVideoRefs(refs: VideoImageDraft[]): number {
  let skipped = 0;
  set((s) => {
    const room = VIDEO_MAX_REFS - s.video.draft.refs.length;
    const take = refs.slice(0, Math.max(0, room));
    skipped = refs.length - take.length;
    if (!take.length) return s;
    return {
      video: {
        ...s.video,
        draft: { ...s.video.draft, refs: [...s.video.draft.refs, ...take] },
      },
    };
  });
  return skipped;
}

export const removeVideoRef = (id: string) =>
  set((s) => ({
    video: {
      ...s.video,
      draft: {
        ...s.video.draft,
        refs: s.video.draft.refs.filter((ref) => ref.id !== id),
      },
    },
  }));

export const clearVideoRefs = () =>
  set((s) => ({
    video: { ...s.video, draft: { ...s.video.draft, refs: [] } },
  }));

export const setVideoFrame = (
  slot: "first" | "last",
  image: VideoImageDraft | null,
) =>
  set((s) => ({
    video: {
      ...s.video,
      draft: {
        ...s.video.draft,
        frames: { ...s.video.draft.frames, [slot]: image },
      },
    },
  }));

/** 用一张图打开图生视频：放进参考图，并离开首尾帧工作流 */
export const openVideoWithRef = (image: VideoImageDraft) =>
  set((s) => {
    const draft = s.video.draft;
    const refWorkflowId = refWorkflows().some(
      (item) => item.id === draft.refWorkflowId,
    )
      ? draft.refWorkflowId
      : VIDEO_DEFAULT_WORKFLOW;
    return {
      view: {
        ...s.view,
        playgroundOpen: true,
        lightboxId: null,
        focusIdx: null,
        previewId: null,
        drawerOpen: false,
      },
      video: {
        ...s.video,
        previewId: null,
        draft: {
          ...draft,
          entry: "ref",
          refWorkflowId,
          resolution: refResolution(draft, refWorkflowId),
          refs: [image],
        },
      },
    };
  });

/** 把一条视频记录的参数和参考图带回表单 */
export const loadVideoDraft = (row: VideoRecord) =>
  set((s) => {
    const images: VideoImageDraft[] = row.refs.map((ref, index) => ({
      id: `${row.id}-${index}`,
      blob: ref.blob,
      name: ref.name,
    }));
    const draft = s.video.draft;
    const framesMode = row.inputMode === "frames";
    const next: VideoDraft = {
      ...draft,
      entry: row.entry,
      prompt: row.prompt,
      duration: String(row.duration || 5),
      resolution: row.resolution || draft.resolution,
      seeds: { ...draft.seeds, [row.workflow]: row.seed },
    };
    if (row.entry === "custom") {
      next.customWorkflowId = row.workflow;
      next.customInput = framesMode ? "frames" : "refs";
      next.customResolution = row.resolution || draft.customResolution;
    } else if (row.entry === "frames" || framesMode) {
      next.entry = "frames";
    } else if (refWorkflows().some((item) => item.id === row.workflow)) {
      next.refWorkflowId = row.workflow;
      next.resolutions = {
        ...draft.resolutions,
        [row.workflow]: row.resolution,
      };
    }
    if (framesMode)
      next.frames = { first: images[0] ?? null, last: images[1] ?? null };
    else next.refs = images.slice(0, VIDEO_MAX_REFS);
    return { video: { ...s.video, previewId: null, draft: next } };
  });

/** 提交已经落库：关掉表单，清掉提示词和图片，保留工作流选择 */
export const consumeVideoDraft = () =>
  set((s) => ({
    video: {
      ...s.video,
      draft: {
        ...s.video.draft,
        entry: null,
        prompt: "",
        refs: [],
        frames: { first: null, last: null },
      },
    },
  }));

export function beginVideoSubmit(): boolean {
  let started = false;
  set((s) => {
    if (s.video.submitting) return s;
    started = true;
    return { video: { ...s.video, submitting: true } };
  });
  return started;
}

export const endVideoSubmit = () =>
  set((s) =>
    s.video.submitting ? { video: { ...s.video, submitting: false } } : s,
  );

export const openVideoPreview = (id: string) =>
  set((s) => ({ video: { ...s.video, previewId: id } }));

export const closeVideoPreview = () =>
  set((s) => ({ video: { ...s.video, previewId: null } }));
