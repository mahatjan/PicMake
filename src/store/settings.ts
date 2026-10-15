/** 设置存储：仅存 localStorage */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOCALE_PREF, type LocalePref } from "../lib/locale";
import { DEFAULT_BASE_URL } from "../lib/url";
import { DEFAULT_THEME, type ThemePref } from "../lib/theme";

interface SettingsState {
  baseUrl: string;
  apiKey: string;
  /** autodl.art 生视频 Token，与生图 Key 分开 */
  videoApiKey: string;
  /** 旧页面视频记录已尝试导入 */
  videoLegacyImported: boolean;
  theme: ThemePref;
  locale: LocalePref;
  setApi: (baseUrl: string, apiKey: string) => void;
  setVideoApiKey: (videoApiKey: string) => void;
  markVideoLegacyImported: () => void;
  setTheme: (theme: ThemePref) => void;
  setLocale: (locale: LocalePref) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
      videoApiKey: "",
      videoLegacyImported: false,
      theme: DEFAULT_THEME,
      locale: DEFAULT_LOCALE_PREF,
      setApi: (baseUrl, apiKey) => set({ baseUrl, apiKey }),
      setVideoApiKey: (videoApiKey) => set({ videoApiKey }),
      markVideoLegacyImported: () => set({ videoLegacyImported: true }),
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
    }),
    { name: "PicMake-settings" },
  ),
);
