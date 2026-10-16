/** 设置弹窗：纯展示的受控弹层 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  Modal,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  Spinner,
} from "@heroui/react";
import { LOCALE_NAMES } from "../../i18n/resources/locale-names";
import { errorHint } from "../../i18n/errors";
import { fmtBytes } from "../../lib/format";
import type { ApiProfile, ApiProfilesDraft } from "../../lib/api-profiles";
import { DEFAULT_BASE_URL } from "../../lib/url";
import { LOCALES, type LocalePref } from "../../lib/locale";
import type { ThemePref } from "../../lib/theme";
import type { ApiErrorKind } from "../../lib/types";
import { Segmented, Switch } from "../controls";

interface TestResult {
  ok: true;
  models: string[];
}
type TestConn = (
  baseUrl: string,
  apiKey: string,
) => Promise<TestResult | { ok: false; kind: ApiErrorKind }>;

/** 连接测试的结果：存数据，文案渲染时按当前语言生成 */
type Outcome =
  | { ok: true; models: number; series: boolean }
  | { ok: false; kind: ApiErrorKind };

/* ── 设置弹窗 ── */
export function SettingsModal(props: {
  open: boolean;
  apiProfiles: ApiProfile[];
  activeApiProfileId: string;
  streamEnabled: boolean;
  videoApiKey: string;
  /** 本机存储统计：记录数、图片数、已用字节（浏览器不支持估算时为 null） */
  storage: { generations: number; images: number; usageBytes: number | null };
  theme: ThemePref;
  onThemeChange: (theme: ThemePref) => void;
  locale: LocalePref;
  onLocaleChange: (locale: LocalePref) => void;
  onTest: TestConn;
  onSave: (
    draft: ApiProfilesDraft,
    videoApiKey: string,
    streamEnabled: boolean,
  ) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // 弹窗内编辑整份草稿，切换配置保留编辑，关闭时由父级卸载并丢弃。
  const [draft, setDraft] = useState<ApiProfilesDraft>({
    apiProfiles: props.apiProfiles,
    activeApiProfileId: props.activeApiProfileId,
  });
  const activeProfile = draft.apiProfiles.find(
    (profile) => profile.id === draft.activeApiProfileId,
  )!;
  const { baseUrl, apiKey } = activeProfile;
  const patchProfile = (
    patch: Partial<Pick<ApiProfile, "name" | "baseUrl" | "apiKey">>,
  ) =>
    setDraft((current) => ({
      ...current,
      apiProfiles: current.apiProfiles.map((profile) =>
        profile.id === current.activeApiProfileId
          ? { ...profile, ...patch }
          : profile,
      ),
    }));
  const [videoApiKey, setVideoApiKey] = useState(props.videoApiKey);
  const [streamEnabled, setStreamEnabled] = useState(props.streamEnabled);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{
    profileId: string;
    baseUrl: string;
    apiKey: string;
    outcome: Outcome;
  } | null>(null);
  // 只展示当前地址和 Key 的测试结果，忽略切换配置或编辑后返回的过期结果。
  const outcome =
    tested?.profileId === activeProfile.id &&
    tested.baseUrl === baseUrl &&
    tested.apiKey === apiKey
      ? tested.outcome
      : null;

  const { generations, images, usageBytes } = props.storage;
  const storageParts = {
    generations: t("count.generations", { count: generations }),
    images: t("count.images", { count: images }),
  };
  const storageText =
    usageBytes == null
      ? t("settings.storage", storageParts)
      : t("settings.storageUsed", {
          ...storageParts,
          size: fmtBytes(usageBytes),
        });
  const resultText = !outcome
    ? null
    : !outcome.ok
      ? errorHint(outcome.kind, t)
      : t(outcome.series ? "settings.testOkWith" : "settings.testOkWithout", {
          count: outcome.models,
        });

  return (
    <Modal
      isOpen={props.open}
      onOpenChange={(o) => {
        if (!o) props.onClose();
      }}
    >
      <ModalBackdrop>
        <ModalContainer placement="center">
          <ModalDialog aria-label={t("settings.title")} className="pm-modal">
            <Modal.CloseTrigger />
            <h3>{t("settings.heading")}</h3>
            <p className="sub">{t("settings.subtitle")}</p>
            <label>{t("settings.appearance")}</label>
            <Segmented
              full
              ariaLabel={t("settings.appearance")}
              options={[
                { value: "light", label: t("settings.themeLight") },
                { value: "dark", label: t("settings.themeDark") },
                { value: "system", label: t("common.followSystem") },
              ]}
              value={props.theme}
              onChange={props.onThemeChange}
            />
            <label>{t("settings.language")}</label>
            <Segmented<LocalePref>
              full
              ariaLabel={t("settings.language")}
              options={[
                { value: "system", label: t("common.followSystem") },
                ...LOCALES.map((locale) => ({
                  value: locale,
                  label: LOCALE_NAMES[locale],
                })),
              ]}
              value={props.locale}
              onChange={props.onLocaleChange}
            />
            <label htmlFor="s-profile">{t("settings.apiProfile")}</label>
            <div className="pm-settings-profiles">
              <select
                id="s-profile"
                value={draft.activeApiProfileId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    activeApiProfileId: event.target.value,
                  }))
                }
              >
                {draft.apiProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name.trim() || t("settings.defaultProfile")}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                isIconOnly
                aria-label={t("settings.addProfile")}
                onPress={() => {
                  const profile: ApiProfile = {
                    id: crypto.randomUUID(),
                    name: t("settings.newProfileName", {
                      index: draft.apiProfiles.length + 1,
                    }),
                    baseUrl: DEFAULT_BASE_URL,
                    apiKey: "",
                  };
                  setDraft((current) => ({
                    apiProfiles: [...current.apiProfiles, profile],
                    activeApiProfileId: profile.id,
                  }));
                }}
              >
                <Plus size={16} aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isIconOnly
                isDisabled={draft.apiProfiles.length <= 1}
                aria-label={t("settings.deleteProfile")}
                onPress={() =>
                  setDraft((current) => {
                    if (current.apiProfiles.length <= 1) return current;
                    const apiProfiles = current.apiProfiles.filter(
                      (profile) => profile.id !== current.activeApiProfileId,
                    );
                    return {
                      apiProfiles,
                      activeApiProfileId: apiProfiles[0].id,
                    };
                  })
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
            <p className="pm-hint">{t("settings.profileHint")}</p>
            <label htmlFor="s-profile-name">{t("settings.profileName")}</label>
            <Input
              id="s-profile-name"
              autoComplete="off"
              placeholder={t("settings.defaultProfile")}
              value={activeProfile.name}
              onChange={(event) => patchProfile({ name: event.target.value })}
            />
            <label htmlFor="s-base">{t("settings.baseUrl")}</label>
            <Input
              id="s-base"
              autoComplete="off"
              value={baseUrl}
              onChange={(e) => patchProfile({ baseUrl: e.target.value })}
            />
            <p className="pm-hint">{t("settings.baseUrlHint")}</p>
            <label htmlFor="s-key">{t("settings.apiKey")}</label>
            <Input
              id="s-key"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => patchProfile({ apiKey: e.target.value })}
            />
            {resultText && (
              <p className={"pm-tconn" + (outcome?.ok ? " ok" : "")}>
                {resultText}
              </p>
            )}
            <p className="pm-hint">{t("settings.keyHint")}</p>
            <div className="pm-settings-stream">
              <span>{t("settings.streamEnabled")}</span>
              <Switch
                checked={streamEnabled}
                onChange={setStreamEnabled}
                ariaLabel={t("settings.streamEnabled")}
              />
            </div>
            <p className="pm-hint">{t("settings.streamHint")}</p>
            <label htmlFor="s-video-key">{t("settings.videoKey")}</label>
            <Input
              id="s-video-key"
              autoComplete="off"
              value={videoApiKey}
              onChange={(e) => setVideoApiKey(e.target.value)}
            />
            <p className="pm-hint">{t("settings.videoKeyHint")}</p>
            <p className="pm-hint">{storageText}</p>
            <div className="pm-mbtns">
              <Button
                variant="secondary"
                isDisabled={testing}
                onPress={() => {
                  setTesting(true);
                  setTested(null);
                  void props.onTest(baseUrl, apiKey).then((r) => {
                    setTesting(false);
                    setTested({
                      profileId: activeProfile.id,
                      baseUrl,
                      apiKey,
                      outcome: r.ok
                        ? {
                            ok: true,
                            models: r.models.length,
                            series: r.models.some((m) =>
                              m.includes("gpt-image-2.5"),
                            ),
                          }
                        : r,
                    });
                  });
                }}
              >
                {testing ? <Spinner size="sm" /> : t("settings.test")}
              </Button>
              <Button
                variant="primary"
                onPress={() => props.onSave(draft, videoApiKey, streamEnabled)}
              >
                {t("common.save")}
              </Button>
            </div>
          </ModalDialog>
        </ModalContainer>
      </ModalBackdrop>
    </Modal>
  );
}
