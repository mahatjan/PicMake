import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toast } from "@heroui/react";
import "./index.css";
import App from "./App.tsx";
import { LocaleRoot } from "./containers/LocaleRoot";
import { initI18n } from "./i18n";
import { resolveLocale } from "./lib/locale";
import { useSettings } from "./store/settings";
import { initWorkspace } from "./store/workspace/actions";

// 语言：渲染前就初始化，首帧即是正确的语言（资源随包内置，无请求）；之后由 useLocale 跟随偏好
const locale = resolveLocale(
  useSettings.getState().locale,
  navigator.languages,
);
initI18n(locale);
document.documentElement.lang = locale;

// 首次引导：没有 apiKey 时打开设置（settings 已从 localStorage 同步恢复）
initWorkspace({ settingsOpen: !useSettings.getState().apiKey });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleRoot>
      <App />
      {/* toast() 只负责入队，必须挂这个区域才会显示。顶部居中避开左上导航、右上详情浮卡和底部创作条，
          窄屏下移到顶栏下方（见 chrome.css）；
          hotkey 置空：不提供应用快捷键，且 macOS 上 Option+T 用于输入字符 */}
      <Toast.Provider placement="top" hotkey={[]} />
    </LocaleRoot>
  </StrictMode>,
);
