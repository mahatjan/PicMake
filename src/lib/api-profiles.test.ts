import { describe, expect, it } from "vitest";
import { apiProfilesPatch, restoreApiProfiles } from "./api-profiles";
import { DEFAULT_BASE_URL } from "./url";

const profiles = [
  { id: "a", name: "A配置", baseUrl: "https://a.com", apiKey: "Akey" },
  { id: "b", name: "xxx配置", baseUrl: "https://a.com", apiKey: "Bkey" },
  { id: "c", name: "sssss配置", baseUrl: "https://c.com", apiKey: "Ckey" },
];

describe("API 配置", () => {
  it("同一地址可对应不同 Key，按 id 一起切换地址与 Key", () => {
    for (const active of profiles) {
      expect(
        apiProfilesPatch({
          apiProfiles: profiles,
          activeApiProfileId: active.id,
        }),
      ).toEqual({
        apiProfiles: profiles,
        activeApiProfileId: active.id,
        baseUrl: active.baseUrl,
        apiKey: active.apiKey,
      });
    }
  });

  it("保存时拒绝空列表和不存在的配置", () => {
    expect(
      apiProfilesPatch({ apiProfiles: [], activeApiProfileId: "a" }),
    ).toBeNull();
    expect(
      apiProfilesPatch({
        apiProfiles: profiles,
        activeApiProfileId: "missing",
      }),
    ).toBeNull();
  });

  it("旧地址和 Key 原样迁移为默认配置", () => {
    const restored = restoreApiProfiles({
      baseUrl: "https://old.com/v1",
      apiKey: "old-key",
    });
    expect(restored.apiProfiles).toEqual([
      {
        id: "default",
        name: "",
        baseUrl: "https://old.com/v1",
        apiKey: "old-key",
      },
    ]);
    expect(restored.activeApiProfileId).toBe("default");
    expect(restored.baseUrl).toBe("https://old.com/v1");
    expect(restored.apiKey).toBe("old-key");
  });

  it("首次使用保留默认地址和空 Key", () => {
    expect(restoreApiProfiles({})).toMatchObject({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
    });
  });

  it("恢复时以所选配置为准，忽略旧的活动地址和 Key", () => {
    expect(
      restoreApiProfiles({
        apiProfiles: profiles,
        activeApiProfileId: "b",
        baseUrl: "stale",
        apiKey: "stale",
      }),
    ).toMatchObject({
      activeApiProfileId: "b",
      baseUrl: "https://a.com",
      apiKey: "Bkey",
    });
  });

  it("恢复时无效的配置 id 回退到首条，空列表回退到旧配置", () => {
    expect(
      restoreApiProfiles({
        apiProfiles: profiles,
        activeApiProfileId: "missing",
      }),
    ).toMatchObject({
      activeApiProfileId: "a",
      baseUrl: "https://a.com",
      apiKey: "Akey",
    });
    expect(
      restoreApiProfiles({ apiProfiles: [], apiKey: "legacy" }).apiKey,
    ).toBe("legacy");
  });
});
