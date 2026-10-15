/** 应用组合：订阅历史、算一次图片资源，交给各区域容器 */
import { useEffect } from "react";
import { AppDialogs } from "./containers/AppDialogs";
import { ChromeArea } from "./containers/ChromeArea";
import { CreateArea } from "./containers/CreateArea";
import { DrawingLayer } from "./containers/DrawingLayer";
import { ResultArea } from "./containers/ResultArea";
import { PlaygroundArea } from "./containers/PlaygroundArea";
import { startHistorySync } from "./flows/history-sync";
import { startVideoSync } from "./flows/video";
import { useWorkspaceAssets } from "./hooks/useWorkspaceAssets";

export default function App() {
  // 历史列表订阅：IndexedDB 变更回推到 store，卸载时退订
  useEffect(() => startHistorySync(), []);
  useEffect(() => startVideoSync(), []);
  // display / sourceImages / thumbnailUrls 只算一次，避免重复读库和重复创建 URL
  const assets = useWorkspaceAssets();

  // DOM 顺序即 Tab 顺序：顶栏 → 结果区（舞台、详情浮卡）→ 创作条
  return (
    <>
      <ChromeArea assets={assets} />
      <ResultArea assets={assets} />
      <CreateArea assets={assets} />
      <DrawingLayer />
      <AppDialogs />
      <PlaygroundArea />
    </>
  );
}
