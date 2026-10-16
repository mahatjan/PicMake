import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "./settings";

const { values } = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  });
  return { values };
});
const initial = useSettings.getState();
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  useSettings.setState(initial, true);
  values.clear();
});

describe("配置保存与恢复", () => {
  it("保存选中的组合，同时保留其他配置和视频、流式设置", async () => {
    const apiProfiles = [
      { id: "a", name: "A", baseUrl: "https://a.com", apiKey: "Akey" },
      { id: "b", name: "B", baseUrl: "https://a.com", apiKey: "Bkey" },
    ];
    expect(
      useSettings
        .getState()
        .saveApiProfiles(
          { apiProfiles, activeApiProfileId: "b" },
          "video-token",
          false,
        ),
    ).toBe(true);
    expect(useSettings.getState()).toMatchObject({
      apiProfiles,
      activeApiProfileId: "b",
      baseUrl: "https://a.com",
      apiKey: "Bkey",
      videoApiKey: "video-token",
      streamEnabled: false,
    });
    expect([...values.keys()]).toEqual(["PicMake-settings"]);
    // 模拟下次加载时从同一存储键恢复，而不是依赖内存状态。
    const saved = values.get("PicMake-settings")!;
    useSettings.setState(initial, true);
    values.set("PicMake-settings", saved);
    await useSettings.persist.rehydrate();
    expect(useSettings.getState()).toMatchObject({
      apiProfiles,
      activeApiProfileId: "b",
      apiKey: "Bkey",
      videoApiKey: "video-token",
      streamEnabled: false,
    });
  });

  it("旧版持久化数据保留 Key、语言、主题和视频配置", async () => {
    values.set(
      "PicMake-settings",
      JSON.stringify({
        version: 0,
        state: {
          baseUrl: "https://legacy.com",
          apiKey: "legacy-key",
          locale: "en",
          theme: "dark",
          videoApiKey: "video-key",
        },
      }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState()).toMatchObject({
      activeApiProfileId: "default",
      baseUrl: "https://legacy.com",
      apiKey: "legacy-key",
      locale: "en",
      theme: "dark",
      videoApiKey: "video-key",
      streamEnabled: true,
    });
    expect(useSettings.getState().apiProfiles[0].apiKey).toBe("legacy-key");
  });

  it("活动配置不存在时拒绝保存，保持现有状态和持久化数据", () => {
    const before = useSettings.getState();
    expect(
      before.saveApiProfiles(
        { apiProfiles: [], activeApiProfileId: "missing" },
        "other",
        false,
      ),
    ).toBe(false);
    expect(useSettings.getState()).toBe(before);
    expect(values.size).toBe(0);
  });
});
