/** 设置存储：仅存 localStorage */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOCALE_PREF, type LocalePref } from "../lib/locale";
import { DEFAULT_BASE_URL } from "../lib/url";
import { DEFAULT_THEME, type ThemePref } from "../lib/theme";
import {
  apiProfilesPatch,
  restoreApiProfiles,
  type ApiProfilesDraft,
} from "../lib/api-profiles";

interface SettingsState extends ApiProfilesDraft {
  baseUrl: string;
  apiKey: string;
  streamEnabled: boolean;
  /** autodl.art 生视频 Token，与生图 Key 分开 */
  videoApiKey: string;
  /** 旧页面视频记录已尝试导入 */
  videoLegacyImported: boolean;
  theme: ThemePref;
  locale: LocalePref;
  /** 提交任务后保留创作条内容（描述、参考图与参数）；默认不保留，提交后草稿复位 */
  keepDraft: boolean;
  saveApiProfiles: (
    draft: ApiProfilesDraft,
    videoApiKey: string,
    streamEnabled: boolean,
  ) => boolean;
  setVideoApiKey: (videoApiKey: string) => void;
  markVideoLegacyImported: () => void;
  setTheme: (theme: ThemePref) => void;
  setLocale: (locale: LocalePref) => void;
  setKeepDraft: (keepDraft: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...restoreApiProfiles({ baseUrl: DEFAULT_BASE_URL }),
      streamEnabled: true,
      videoApiKey: "",
      videoLegacyImported: false,
      theme: DEFAULT_THEME,
      locale: DEFAULT_LOCALE_PREF,
      keepDraft: false,
      saveApiProfiles: (draft, videoApiKey, streamEnabled) => {
        const patch = apiProfilesPatch(draft);
        if (!patch) return false;
        set({ ...patch, videoApiKey, streamEnabled });
        return true;
      },
      setVideoApiKey: (videoApiKey) => set({ videoApiKey }),
      markVideoLegacyImported: () => set({ videoLegacyImported: true }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setKeepDraft: (keepDraft) => set({ keepDraft }),
    }),
    {
      name: "PicMake-settings",
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return { ...current, ...saved, ...restoreApiProfiles(saved ?? {}) };
      },
    },
  ),
);
