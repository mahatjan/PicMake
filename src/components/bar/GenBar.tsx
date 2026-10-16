/** 创作条 generating 态：状态行 + 取消 */
import { useTranslation } from "react-i18next";
import { MODEL_LABELS } from "../../lib/params";
import type { ModelId } from "../../lib/types";

export function GenBar(props: {
  model: ModelId;
  partialIndex: number | null;
  /** 多尺寸生成：已完成的请求数与总数；单尺寸为 null */
  progress: { done: number; total: number } | null;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const step =
    props.partialIndex === null ? null : Math.min(3, props.partialIndex + 1);
  return (
    <div className="pm-bar-gen" role="status">
      <div className="pm-bar-genrow">
        <span className="pm-bar-genmodel">{MODEL_LABELS[props.model]}</span>
        <span className="pm-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="pm-bar-genst">
          {props.progress ? (
            <b>{t("bar.genProgress", props.progress)}</b>
          ) : step === null ? (
            t("stage.generating")
          ) : (
            <>
              {t("bar.genStatus")} <b>{step}/3</b>
            </>
          )}
        </span>
        <button
          type="button"
          className="pm-bar-cancel"
          onClick={props.onCancel}
        >
          ✕ {t("bar.genCancel")}
        </button>
      </div>
      <div className="pm-shimmer" aria-hidden />
      <p className="pm-bar-gennote">
        {props.progress ? t("bar.genNoteMulti") : t("bar.genNote")}
      </p>
    </div>
  );
}
