/** 创作条生成摘要：并行任务数与全部取消，描述与参数继续可编辑。 */
import { useTranslation } from "react-i18next";
import { MODEL_LABELS } from "../../lib/params";
import type { ModelId } from "../../lib/types";

export function GenBar(props: {
  model: ModelId;
  partialIndex: number | null;
  /** 多尺寸生成：已完成的请求数与总数；单尺寸为 null */
  progress: { done: number; total: number } | null;
  activeCount: number;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const step =
    props.partialIndex === null ? null : Math.min(3, props.partialIndex + 1);
  const note =
    props.activeCount > 1
      ? t("bar.genNoteParallel")
      : props.progress
        ? t("bar.genNoteMulti")
        : t("bar.genNote");
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
          {props.activeCount > 1 ? (
            t("bar.genActive", { count: props.activeCount })
          ) : props.progress ? (
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
          aria-label={t(
            props.activeCount > 1 ? "bar.genCancelAll" : "bar.genCancel",
          )}
          onClick={props.onCancel}
        >
          ✕ {t(props.activeCount > 1 ? "bar.genCancelAll" : "bar.genCancel")}
        </button>
      </div>
      <div className="pm-shimmer" aria-hidden />
      <div className="pm-bar-genfoot">
        <p className="pm-bar-gennote">{note}</p>
      </div>
    </div>
  );
}
