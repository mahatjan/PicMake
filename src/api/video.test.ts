import { afterEach, describe, expect, it, vi } from "vitest";
import { VIDEO_API_BASE } from "../lib/video";
import { queryVideoTask, submitVideoTask } from "./video";

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("submitVideoTask", () => {
  it("把 Token 原文放进 Authorization，并解析 task_id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: "Success", data: { task_id: "task-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      submitVideoTask("token-raw", "flow/a", { prompt: "p", seed: 1 }),
    ).resolves.toEqual({ ok: true, taskId: "task-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${VIDEO_API_BASE}/comfyui_workflow/${encodeURIComponent("flow/a")}`,
    );
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("token-raw");
    expect(headers.get("Authorization")).not.toMatch(/^Bearer /);
  });

  it("业务拒绝保留原文；网络失败返回 network", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "Fail", msg: "排队已满" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitVideoTask("t", "w", {})).resolves.toEqual({
      ok: false,
      failure: { kind: "rejected", message: "排队已满" },
    });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(submitVideoTask("t", "w", {})).resolves.toEqual({
      ok: false,
      failure: { kind: "network" },
    });
  });
});

describe("queryVideoTask", () => {
  it("HTTP 错误带上状态码和服务端原文", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ msg: "nope" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    await expect(queryVideoTask("t", "id 1")).resolves.toEqual({
      ok: false,
      failure: { kind: "http", status: 500, message: "nope" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${VIDEO_API_BASE}/comfyui_workflow/result/${encodeURIComponent("id 1")}`,
    );
  });
});
