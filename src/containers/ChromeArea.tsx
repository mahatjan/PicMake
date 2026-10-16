/** 页面框架：顶栏、历史抽屉与设置弹窗；主题与本机存储用量在这里投影 */
import { useEffect, useState } from "react";
import { TopNav } from "../components/TopNav";
import { HistoryDrawer } from "../components/overlays/HistoryDrawer";
import { SettingsModal } from "../components/overlays/SettingsModal";
import { saveSettings, testConnection } from "../flows/settings";
import { newGeneration, selectHistory, toggleStar } from "../flows/navigation";
import { useTheme } from "../hooks/useTheme";
import type { WorkspaceAssets } from "../hooks/useWorkspaceAssets";
import { canOpenPlayground } from "../lib/workspace-rules";
import { useSettings } from "../store/settings";
import { useWorkspace } from "../store/workspace";
import {
  closeDrawer,
  closePlayground,
  closeSettings,
  openDrawer,
  openPlayground,
  openSettings,
} from "../store/workspace/actions";

export function ChromeArea({ assets }: { assets: WorkspaceAssets }) {
  const { rows, display, thumbnailUrls } = assets;
  const theme = useTheme();
  const apiProfiles = useSettings((s) => s.apiProfiles);
  const activeApiProfileId = useSettings((s) => s.activeApiProfileId);
  const streamEnabled = useSettings((s) => s.streamEnabled);
  const videoApiKey = useSettings((s) => s.videoApiKey);
  const locale = useSettings((s) => s.locale);
  const setLocale = useSettings((s) => s.setLocale);
  const drawerOpen = useWorkspace((s) => s.view.drawerOpen);
  const settingsOpen = useWorkspace((s) => s.view.settingsOpen);
  const playgroundOpen = useWorkspace((s) => s.view.playgroundOpen);
  const drawing = useWorkspace((s) => s.drawing !== null);

  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((est) => {
      if (est?.usage != null) setUsageBytes(est.usage);
    });
  }, [rows.length]);
  const totalImages = rows.reduce((sum, row) => sum + row.imageIds.length, 0);

  return (
    <>
      <TopNav
        theme={theme.resolved}
        onToggleTheme={theme.toggle}
        onNew={newGeneration}
        canNew
        onHistory={openDrawer}
        onSettings={openSettings}
        videoOpen={playgroundOpen}
        canOpenVideo={canOpenPlayground({ drawing })}
        onVideo={() => (playgroundOpen ? closePlayground() : openPlayground())}
      />

      <HistoryDrawer
        open={drawerOpen}
        rows={rows}
        thumbnailUrls={thumbnailUrls}
        currentId={display?.row.id ?? null}
        onSelect={(id) => {
          selectHistory(id);
          closeDrawer();
        }}
        onToggleStar={toggleStar}
        onClose={closeDrawer}
      />

      <SettingsModal
        key={settingsOpen ? "settings-open" : "settings-closed"}
        open={settingsOpen}
        apiProfiles={apiProfiles}
        activeApiProfileId={activeApiProfileId}
        streamEnabled={streamEnabled}
        videoApiKey={videoApiKey}
        storage={{
          generations: rows.length,
          images: totalImages,
          usageBytes,
        }}
        theme={theme.pref}
        onThemeChange={theme.setPref}
        locale={locale}
        onLocaleChange={setLocale}
        onTest={testConnection}
        onSave={saveSettings}
        onClose={closeSettings}
      />
    </>
  );
}
