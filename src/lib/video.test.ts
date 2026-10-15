import { describe, expect, it } from "vitest";
import {
  allVideoResolutions,
  buildVideoBody,
  defaultSeedFor,
  FRAME_WORKFLOW_ID,
  importLegacyVideo,
  interpretPoll,
  parseSubmitResponse,
  pickResolution,
  planVideoSubmit,
  resolutionOptions,
  VIDEO_DEFAULT_WORKFLOW,
  videoFileIssue,
  type VideoPlanInput,
} from "./video";

const base = (over: Partial<VideoPlanInput> = {}): VideoPlanInput => ({
  hasKey: true,
  entry: "ref",
  workflowId: VIDEO_DEFAULT_WORKFLOW,
  customInput: "refs",
  prompt: "海边走路",
  duration: "5",
  resolution: "480p竖",
  seed: "",
  refCount: 1,
  hasFirst: false,
  hasLast: false,
  ...over,
});

describe("resolutionOptions", () => {
  it("参考图工作流只用自己的分辨率，自定义入口用并集且去重", () => {
    const own = resolutionOptions({
      entry: "ref",
      workflowId: VIDEO_DEFAULT_WORKFLOW,
    });
    expect(own[0]).toBe("480p竖");
    expect(own).toContain("1080p(1:1)");
    expect(own.some((item) => item.includes("480*864"))).toBe(false);

    const all = allVideoResolutions();
    expect(resolutionOptions({ entry: "custom", workflowId: "" })).toEqual(all);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("480p竖(480*864)");
    expect(all.filter((item) => item === "480p竖")).toHaveLength(1);
  });

  it("首尾帧锁定工作流，默认分辨率是 768p竖", () => {
    const options = resolutionOptions({
      entry: "frames",
      workflowId: FRAME_WORKFLOW_ID,
    });
    expect(options[0]).toBe("480p竖");
    expect(options).toContain("768p竖");
    expect(options).not.toContain("1080p竖");
  });
});

describe("pickResolution", () => {
  const options = ["480p竖", "768p竖"];

  it("记过的值优先于工作流默认", () => {
    expect(
      pickResolution({
        options,
        cached: "480p竖",
        current: "768p竖",
        preferred: "768p竖",
      }),
    ).toBe("480p竖");
  });

  it("没有记忆时用工作流默认，当前值不在列表里才落到第一项", () => {
    expect(
      pickResolution({
        options,
        current: "1080p横",
        preferred: "768p竖",
      }),
    ).toBe("768p竖");
    expect(pickResolution({ options, current: "768p竖" })).toBe("768p竖");
    expect(pickResolution({ options, current: "nope" })).toBe("480p竖");
  });
});

describe("planVideoSubmit", () => {
  it("缺密钥、空提示词、超长、非法时长、缺图都会拦住", () => {
    expect(planVideoSubmit(base({ hasKey: false })).ok).toBe(false);
    expect(planVideoSubmit(base({ prompt: "  " }))).toMatchObject({
      issue: "empty-prompt",
    });
    expect(planVideoSubmit(base({ prompt: "a".repeat(500001) }))).toMatchObject(
      {
        issue: "prompt-too-long",
      },
    );
    expect(planVideoSubmit(base({ duration: "0" }))).toMatchObject({
      issue: "bad-duration",
    });
    expect(planVideoSubmit(base({ duration: "16" }))).toMatchObject({
      issue: "bad-duration",
    });
    expect(planVideoSubmit(base({ duration: "5.5" }))).toMatchObject({
      issue: "bad-duration",
    });
    expect(planVideoSubmit(base({ refCount: 0 }))).toMatchObject({
      issue: "missing-refs",
    });
  });

  it("留空 seed 用工作流默认；手填必须是 1 到 15 位数字", () => {
    const planned = planVideoSubmit(base());
    expect(planned).toMatchObject({
      ok: true,
      plan: { seed: defaultSeedFor(VIDEO_DEFAULT_WORKFLOW), duration: 5 },
    });
    expect(planVideoSubmit(base({ seed: "12" }))).toMatchObject({
      ok: true,
      plan: { seed: "12" },
    });
    expect(planVideoSubmit(base({ seed: "12a" }))).toMatchObject({
      issue: "bad-seed",
    });
  });

  it("首尾帧必须两张都有，并锁定流程 ID", () => {
    expect(
      planVideoSubmit(
        base({ entry: "frames", hasFirst: true, hasLast: false, refCount: 0 }),
      ),
    ).toMatchObject({ issue: "missing-frames" });
    const planned = planVideoSubmit(
      base({
        entry: "frames",
        workflowId: "ignored",
        hasFirst: true,
        hasLast: true,
        refCount: 0,
        resolution: "不存在",
      }),
    );
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        workflowId: FRAME_WORKFLOW_ID,
        entry: "frames",
        inputMode: "frames",
        resolution: "480p竖",
      },
    });
  });

  it("自定义流程要手填 ID，分辨率不在并集里时落到第一项", () => {
    expect(
      planVideoSubmit(base({ entry: "custom", workflowId: "  ", refCount: 1 })),
    ).toMatchObject({ issue: "missing-workflow" });
    const planned = planVideoSubmit(
      base({
        entry: "custom",
        workflowId: " my_flow ",
        customInput: "refs",
        resolution: "nope",
      }),
    );
    expect(planned).toMatchObject({
      ok: true,
      plan: {
        workflowId: "my_flow",
        entry: "custom",
        inputMode: "refs",
        resolution: "480p竖",
        seed: defaultSeedFor("my_flow"),
      },
    });
  });
});

describe("buildVideoBody", () => {
  const plan = {
    workflowId: "w",
    entry: "ref" as const,
    inputMode: "refs" as const,
    prompt: "p",
    duration: 5,
    resolution: "480p竖",
    seed: "12",
  };

  it("参考图按顺序写成 ref_image_N，首尾帧用 first_frame / last_frame", () => {
    expect(buildVideoBody(plan, ["data:a", "data:b"])).toEqual({
      duration: 5,
      prompt: "p",
      resolution: "480p竖",
      seed: 12,
      ref_image_0: "data:a",
      ref_image_1: "data:b",
    });
    expect(
      buildVideoBody({ ...plan, inputMode: "frames", entry: "frames" }, [
        "data:first",
        "data:last",
      ]),
    ).toMatchObject({
      first_frame: "data:first",
      last_frame: "data:last",
    });
  });
});

describe("parseSubmitResponse / interpretPoll", () => {
  it("提交成功要有 Success 和 task_id，否则保留服务端原文", () => {
    expect(
      parseSubmitResponse({ code: "Success", data: { task_id: "t1" } }),
    ).toEqual({ ok: true, taskId: "t1" });
    expect(parseSubmitResponse({ code: "Fail", msg: "忙" })).toEqual({
      ok: false,
      message: "忙",
    });
    expect(parseSubmitResponse(null)).toEqual({ ok: false, message: "" });
  });

  it("轮询：成功取第一条链接，排队算未完成，其它状态失败", () => {
    expect(
      interpretPoll({
        data: { status: "SUCCESS", results: [{ video_url: "https://v" }] },
      }),
    ).toEqual({ kind: "success", url: "https://v" });
    expect(interpretPoll({ data: { status: "running" } })).toEqual({
      kind: "pending",
    });
    expect(
      interpretPoll({ data: { status: "FAILED", message: "爆了" } }),
    ).toEqual({ kind: "failed", message: "爆了" });
    expect(interpretPoll({ data: { status: "SUCCESS", results: [] } })).toEqual(
      { kind: "failed", message: "" },
    );
  });
});

describe("importLegacyVideo", () => {
  it("跳过图片记录；视频保留参考图；没有 taskId 的 pending 记为中断", () => {
    expect(importLegacyVideo({ id: "a", type: "image" })).toBeNull();
    expect(importLegacyVideo({ type: "video" })).toBeNull();
    const blob = new Blob(["x"], { type: "image/png" });
    const row = importLegacyVideo({
      id: "v1",
      type: "video",
      status: "done",
      taskId: "task",
      workflow: "minimax_h3_lightx2v_v5",
      entry: "ref",
      prompt: "海",
      duration: 5,
      resolution: "480p竖",
      seed: 12,
      inputMode: "refs",
      url: "https://cdn/v.mp4",
      createdAt: 10,
      refImages: [{ blob, name: "a.png", role: "nope" }],
    });
    expect(row).toMatchObject({
      id: "v1",
      status: "done",
      remoteUrl: "https://cdn/v.mp4",
      seed: "12",
      refs: [{ name: "a.png" }],
    });
    expect(row?.refs[0].role).toBeUndefined();
    expect(row?.refs[0].blob).toBe(blob);

    expect(
      importLegacyVideo({
        id: "v2",
        type: "video",
        status: "pending",
        taskId: "",
      }),
    ).toMatchObject({ status: "error", failCode: "interrupted" });
  });
});

describe("videoFileIssue", () => {
  it("只收 png、jpeg、webp，单张不超过 10MB", () => {
    expect(videoFileIssue({ type: "image/gif", size: 10 })).toBe(
      "bad-file-type",
    );
    expect(
      videoFileIssue({ type: "image/png", size: 10 * 1024 * 1024 + 1 }),
    ).toBe("file-too-large");
    expect(videoFileIssue({ type: "image/webp", size: 100 })).toBeNull();
  });
});
