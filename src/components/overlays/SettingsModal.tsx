/** 设置弹窗：纯展示的受控弹层 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { LOCALES, type LocalePref } from "../../lib/locale";
import type { ThemePref } from "../../lib/theme";
import type { ApiErrorKind } from "../../lib/types";
import { Segmented } from "../controls";

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
  baseUrl: string;
  apiKey: string;
  videoApiKey: string;
  /** 本机存储统计：记录数、图片数、已用字节（浏览器不支持估算时为 null） */
  storage: { generations: number; images: number; usageBytes: number | null };
  theme: ThemePref;
  onThemeChange: (theme: ThemePref) => void;
  locale: LocalePref;
  onLocaleChange: (locale: LocalePref) => void;
  onTest: TestConn;
  onSave: (baseUrl: string, apiKey: string, videoApiKey: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(props.baseUrl);
  const [apiKey, setApiKey] = useState(props.apiKey);
  const [videoApiKey, setVideoApiKey] = useState(props.videoApiKey);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

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
            <label htmlFor="s-base">{t("settings.baseUrl")}</label>
            <Input
              id="s-base"
              autoComplete="off"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="pm-hint">{t("settings.baseUrlHint")}</p>
            <label htmlFor="s-key">{t("settings.apiKey")}</label>
            <Input
              id="s-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {resultText && (
              <p className={"pm-tconn" + (outcome?.ok ? " ok" : "")}>
                {resultText}
              </p>
            )}
            <p className="pm-hint">{t("settings.keyHint")}</p>
            <label htmlFor="s-video-key">{t("settings.videoKey")}</label>
            <Input
              id="s-video-key"
              type="password"
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
                  setOutcome(null);
                  void props.onTest(baseUrl, apiKey).then((r) => {
                    setTesting(false);
                    setOutcome(
                      r.ok
                        ? {
                            ok: true,
                            models: r.models.length,
                            series: r.models.some((m) =>
                              m.includes("gpt-image-2.5"),
                            ),
                          }
                        : r,
                    );
                  });
                }}
              >
                {testing ? <Spinner size="sm" /> : t("settings.test")}
              </Button>
              <Button
                variant="primary"
                onPress={() => props.onSave(baseUrl, apiKey, videoApiKey)}
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
