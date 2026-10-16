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
  saveApiProfiles: (
    draft: ApiProfilesDraft,
    videoApiKey: string,
    streamEnabled: boolean,
  ) => boolean;
  setVideoApiKey: (videoApiKey: string) => void;
  markVideoLegacyImported: () => void;
  setTheme: (theme: ThemePref) => void;
  setLocale: (locale: LocalePref) => void;
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
