/** 灯箱：纯展示的受控弹层 */
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import { X } from "lucide-react";
import type { DisplayImage } from "../../lib/view-models";

/* ── 灯箱 ── */
export function Lightbox(props: {
  img: DisplayImage | null;
  prompt: string;
  onDownload: () => void;
  onReuse?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!props.img) return null;
  return (
    <div
      className="pm-lb"
      role="dialog"
      aria-label={t("lightbox.label")}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <button
        type="button"
        className="pm-x-btn"
        aria-label={t("lightbox.close")}
        onClick={props.onClose}
      >
        <X size={15} />
      </button>
      <div className="pm-lb-wrap">
        <div
          className="pm-lb-im"
          style={{ backgroundImage: `url(${props.img.url})` }}
          role="img"
          aria-label={props.prompt}
          onClick={props.onClose}
        />
        <div className="pm-lb-bar">
          <p>{props.prompt}</p>
          <div className="pm-lb-actions">
            <Button variant="secondary" onPress={props.onDownload}>
              {t("common.download")}
            </Button>
            {props.onReuse && (
              <Button variant="primary" onPress={props.onReuse}>
                {t("stage.reuse")}
              </Button>
            )}
            <Button variant="secondary" onPress={props.onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
