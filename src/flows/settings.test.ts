import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@heroui/react", () => ({ toast: vi.fn() }));
vi.mock("../api/client", () => ({ testConnection: vi.fn() }));
const setApi = vi.fn();
const setVideoApiKey = vi.fn();
vi.mock("../store/settings", () => ({
  useSettings: { getState: () => ({ setApi, setVideoApiKey }) },
}));

import { toast } from "@heroui/react";
import { testConnection as requestModels } from "../api/client";
import { ApiError } from "../lib/types";
import { initialWorkspace, useWorkspace } from "../store/workspace";
import { openSettings } from "../store/workspace/actions";
import { saveSettings, testConnection } from "./settings";

beforeEach(() => {
  useWorkspace.setState(initialWorkspace(), true);
  vi.mocked(toast).mockClear();
  setApi.mockClear();
  setVideoApiKey.mockClear();
  vi.mocked(requestModels).mockReset();
});

describe("saveSettings", () => {
  it("写入配置、关闭设置弹窗并提示", () => {
    openSettings();
    saveSettings("http://x/v1", "sk-1", "video-token");
    expect(setApi).toHaveBeenCalledWith("http://x/v1", "sk-1");
    expect(setVideoApiKey).toHaveBeenCalledWith("video-token");
    expect(useWorkspace.getState().view.settingsOpen).toBe(false);
    expect(toast).toHaveBeenCalledWith("设置已保存");
  });
});

describe("testConnection", () => {
  it("成功：原样返回模型列表", async () => {
    const ok = { ok: true as const, models: ["m1"] };
    vi.mocked(requestModels).mockResolvedValue(ok);
    await expect(testConnection("u", "k")).resolves.toEqual(ok);
  });

  it("失败：只返回错误种类，不泄露原始错误", async () => {
    vi.mocked(requestModels).mockResolvedValue({
      ok: false,
      error: new ApiError("auth", "raw secret detail"),
    } as never);
    await expect(testConnection("u", "k")).resolves.toEqual({
      ok: false,
      kind: "auth",
    });
  });
});
