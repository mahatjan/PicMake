/** 视频记录预览：播放远程视频，或在还没有地址时显示封面。 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { VideoStatus } from "../../lib/video";

export function VideoPreview(props: {
  status: VideoStatus;
  prompt: string;
  meta: string;
  url: string;
  coverUrl: string | null;
  error: string | null;
  onClose: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pm-video-sheet"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className="pm-video-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-preview-title"
      >
        <header className="pm-video-head">
          <div className="pm-video-head-text">
            <h2 id="video-preview-title">{t("video.preview")}</h2>
            <p>{props.meta}</p>
          </div>
          <button
            type="button"
            className="pm-video-x"
            onClick={props.onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </header>
        <div className="pm-video-body">
          <div className="pm-video-stage">
            {props.url ? (
              <video
                src={props.url}
                controls
                playsInline
                poster={props.coverUrl ?? undefined}
              />
            ) : props.coverUrl ? (
              <img src={props.coverUrl} alt="" />
            ) : (
              <p>{t(`video.status.${props.status}`)}</p>
            )}
          </div>
          <p className="pm-video-prompt">{props.prompt}</p>
          {props.error && <p className="pm-video-error">{props.error}</p>}
        </div>
        <footer className="pm-video-foot">
          <div className="pm-video-actions">
            <button
              type="button"
              disabled={!props.url}
              onClick={props.onDownload}
            >
              {t("video.download")}
            </button>
            <button type="button" onClick={props.onCopy}>
              {t("video.copy")}
            </button>
            <button type="button" onClick={props.onReuse}>
              {t("video.reuse")}
            </button>
            <button type="button" className="danger" onClick={props.onDelete}>
              {t("video.delete")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
