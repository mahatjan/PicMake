/** 舞台右上详情浮卡，纯展示；局部重绘记录提供「查看选区/调整上次重绘」 */
import { useTranslation } from "react-i18next";
import { Star, X } from "lucide-react";
import { fmtTime } from "../i18n/format";
import { inputName, ratioOrSize, sizeText } from "../i18n/labels";
import { fmtDuration } from "../lib/format";
import { MODEL_LABELS, missingSizes } from "../lib/params";
import type { DisplayGen, DisplayInput } from "../lib/view-models";

/** 窄屏收起详情时的入口，点开后才出现浮卡 */
export function DetailToggle(props: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="pm-island pm-detail-toggle"
      aria-label={t("detail.label")}
      onClick={props.onOpen}
    >
      {t("detail.open")}
    </button>
  );
}

export function DetailCard(props: {
  display: DisplayGen;
  selectedImageId: string | null;
  canEdit: boolean;
  sources: DisplayInput[];
  onViewSource: (id: string) => void;
  onDownload: () => void;
  onCopyPrompt: () => void;
  onReuse: () => void;
  onEdit: (imageId: string) => void;
  /** 对选中的一张发起局部重绘 */
  onInpaint: (imageId: string) => void;
  onDelete: () => void;
  onToggleStar: () => void;
  onNew: () => void;
  onClose: () => void;
  /** 查看已保存选区（只读） */
  onViewMask?: () => void;
  /** 恢复上次草稿（不生成） */
  onAdjustInpaint?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { row, images } = props.display;
  const p = row.params;
  const starred = !!row.starred;
  const editImageId = props.selectedImageId ?? images[0]?.id ?? null;
  const inpaintRow = !!row.inpaint;
  // 多尺寸记录：尺寸列出每张图的实际像素，不显示张数；部分失败时标出没出图的比例
  const sizes = p.sizes;
  const missing = sizes
    ? missingSizes(
        sizes,
        images.map((image) => ({ w: image.width, h: image.height })),
      )
    : [];
  return (
    <aside className="pm-island pm-detail" aria-label={t("detail.label")}>
      <header className="pm-detail-cap">
        <b>{t("detail.heading")}</b>
        <span className="t">{fmtTime(row.createdAt, i18n)}</span>
        <button
          type="button"
          className={"pm-detail-star" + (starred ? " on" : "")}
          aria-pressed={starred}
          aria-label={starred ? t("detail.unstar") : t("detail.star")}
          title={starred ? t("detail.unstarTitle") : t("detail.starTitle")}
          onClick={props.onToggleStar}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          aria-label={t("detail.collapse")}
          onClick={props.onClose}
        >
          <X size={12} />
        </button>
      </header>
      <div className="pm-detail-chips">
        <span className="pm-detail-chip">
          {t("detail.model")} <b>{MODEL_LABELS[p.model]}</b>
        </span>
        {sizes ? (
          <span className="pm-detail-chip sizes">
            {t("detail.size")}
            <b>
              {images.map((image) => (
                <span key={image.id}>
                  {sizeText({ w: image.width, h: image.height }, t)}
                </span>
              ))}
            </b>
          </span>
        ) : (
          <span className="pm-detail-chip">
            {t("detail.size")} <b>{sizeText(p.size, t)}</b>
          </span>
        )}
        <span className="pm-detail-chip">
          {t("detail.quality")} <b>{t(`params.qualityLevel.${p.quality}`)}</b>
        </span>
        {!sizes && (
          <span className="pm-detail-chip">
            {t("detail.count")} <b>{images.length}</b>
          </span>
        )}
        <span className="pm-detail-chip">
          <b>{p.outputFormat.toUpperCase()}</b>
        </span>
      </div>
      {missing.length > 0 && (
        <p className="pm-detail-hint" role="status">
          {t("detail.missingSizes", {
            sizes: missing.map(ratioOrSize).join(t("detail.missingSeparator")),
          })}
        </p>
      )}
      <div className="pm-detail-promptcap">
        <span>{t("detail.prompt")}</span>
        <button type="button" onClick={props.onCopyPrompt}>
          {t("detail.copy")}
        </button>
      </div>
      <p className="pm-detail-prompt">{row.prompt}</p>
      {row.originPrompt && row.originPrompt !== row.prompt && (
        <p className="pm-detail-origin">
          <span>{t("detail.origin")}</span>
          {row.originPrompt}
        </p>
      )}
      {!!props.sources.length && (
        <>
          <div className="pm-detail-srcs">
            {props.sources.map((image, index) => (
              <button
                key={image.id}
                type="button"
                className="pm-detail-src"
                aria-label={t("detail.previewSource", { index: index + 1 })}
                onClick={() => props.onViewSource(image.id)}
              >
                {image.url ? (
                  <img src={image.url} alt={inputName(image.naming, t)} />
                ) : (
                  <span>{t("common.unavailable")}</span>
                )}
              </button>
            ))}
          </div>
          <p className="pm-detail-hint">
            {t("detail.sourceInfo", {
              count: props.sources.length,
              fidelity:
                row.inputFidelity === "high"
                  ? t("params.fidelityHigh")
                  : row.inputFidelity === "low"
                    ? t("params.fidelityLow")
                    : t("common.auto"),
            })}
          </p>
        </>
      )}
      <div className="pm-detail-acts">
        <button type="button" onClick={props.onDownload}>
          {t("detail.download")}
        </button>
        <button type="button" onClick={props.onReuse}>
          {t("detail.reuse")}
        </button>
        <button
          type="button"
          disabled={!editImageId || !props.canEdit}
          onClick={() => editImageId && props.onEdit(editImageId)}
        >
          {t("detail.edit")}
        </button>
      </div>
      <div className="pm-detail-acts">
        {inpaintRow ? (
          <>
            {props.onViewMask && (
              <button type="button" onClick={props.onViewMask}>
                {t("detail.viewMask")}
              </button>
            )}
            {props.onAdjustInpaint && (
              <button
                type="button"
                disabled={!props.canEdit}
                onClick={props.onAdjustInpaint}
              >
                {t("detail.adjustInpaint")}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled={!editImageId || !props.canEdit}
            onClick={() => editImageId && props.onInpaint(editImageId)}
          >
            {t("detail.inpaint")}
          </button>
        )}
      </div>
      {!inpaintRow && !props.selectedImageId && images.length > 1 && (
        <p className="pm-detail-hint">{t("detail.pickBeforeInpaint")}</p>
      )}
      {!inpaintRow && props.selectedImageId && (
        <p className="pm-detail-hint">
          {t("detail.inpaintTarget", {
            index: images.findIndex((i) => i.id === props.selectedImageId) + 1,
          })}
        </p>
      )}
      {inpaintRow && row.inpaint && (
        <p className="pm-detail-hint">{t("detail.maskNote")}</p>
      )}
      {!props.selectedImageId && images.length > 1 && (
        <p className="pm-detail-hint">{t("detail.pickBeforeEdit")}</p>
      )}
      {!props.canEdit && (
        <p className="pm-detail-hint">{t("detail.saveFirst")}</p>
      )}
      <button type="button" className="pm-detail-del" onClick={props.onDelete}>
        {t("detail.deleteRecord")}
      </button>
      <button type="button" className="pm-detail-new" onClick={props.onNew}>
        {t("detail.newGeneration")}
      </button>
      <p className="pm-detail-dur">
        {t("detail.duration", { duration: fmtDuration(row.durationMs) })}
      </p>
    </aside>
  );
}
