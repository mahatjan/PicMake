/** 顶左浮岛：品牌 / 首页 / 主题切换 / 历史 / 视频 / 设置 */
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import {
  Clapperboard,
  Clock,
  Film,
  House,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import type { ResolvedTheme } from "../lib/theme";

export function TopNav(props: {
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onNew: () => void;
  canNew: boolean;
  onHistory: () => void;
  onSettings: () => void;
  videoOpen: boolean;
  canOpenVideo: boolean;
  onVideo: () => void;
  gifOpen: boolean;
  canOpenGif: boolean;
  onGif: () => void;
}) {
  const { t } = useTranslation();
  const dark = props.theme === "dark";
  return (
    <nav className="pm-island pm-nav" aria-label={t("nav.label")}>
      <div className="pm-brand">
        <img
          src={`${import.meta.env.BASE_URL}favicon.png`}
          alt=""
          aria-hidden="true"
          className="pm-brand-logo"
        />
        AiTools
      </div>
      <div className="pm-vr" aria-hidden="true" />
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label={t("nav.home")}
        isDisabled={!props.canNew}
        onPress={props.onNew}
      >
        <House size={15} />
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        // 窄屏隐藏（见 chrome.css）：外观在设置里也能切换，把位置让给常用入口
        className="pm-nav-theme"
        aria-label={dark ? t("nav.toLight") : t("nav.toDark")}
        onPress={props.onToggleTheme}
      >
        {dark ? <Sun size={15} /> : <Moon size={15} />}
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label={t("nav.history")}
        onPress={props.onHistory}
      >
        <Clock size={15} />
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label={props.videoOpen ? t("nav.videoClose") : t("nav.video")}
        aria-pressed={props.videoOpen}
        isDisabled={!props.canOpenVideo && !props.videoOpen}
        onPress={props.onVideo}
      >
        <Clapperboard size={15} />
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label={props.gifOpen ? t("nav.gifClose") : t("nav.gif")}
        aria-pressed={props.gifOpen}
        isDisabled={!props.canOpenGif && !props.gifOpen}
        onPress={props.onGif}
      >
        <Film size={15} />
      </Button>
      <Button
        variant="ghost"
        isIconOnly
        size="sm"
        aria-label={t("nav.settings")}
        onPress={props.onSettings}
      >
        <Settings size={15} />
      </Button>
    </nav>
  );
}
