/** 设置流程：保存配置、测试连接（调用 API 与 toast 在这里） */
import { toast } from "@heroui/react";
import { testConnection as requestModels } from "../api/client";
import { t } from "../i18n";
import { useSettings } from "../store/settings";
import { closeSettings } from "../store/workspace/actions";
import type { ApiProfilesDraft } from "../lib/api-profiles";

/** 保存设置（有 apiKey 即视为已引导，启动弹窗由它决定） */
export function saveSettings(
  draft: ApiProfilesDraft,
  videoApiKey: string,
  streamEnabled: boolean,
) {
  const settings = useSettings.getState();
  if (!settings.saveApiProfiles(draft, videoApiKey, streamEnabled)) return;
  closeSettings();
  toast(t("toast.settingsSaved"));
}

export async function testConnection(baseUrl: string, apiKey: string) {
  const result = await requestModels({ baseUrl, apiKey });
  return result.ok ? result : { ok: false as const, kind: result.error.kind };
}
