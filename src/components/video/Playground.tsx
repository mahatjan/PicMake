/** 视频工作台首页：四个入口和视频记录。纯展示。 */
import { useTranslation } from "react-i18next";
import type { VideoEntry, VideoStatus } from "../../lib/video";

export interface VideoCardModel {
  id: string;
  status: VideoStatus;
  prompt: string;
  meta: string;
  coverUrl: string | null;
  error: string | null;
}

export function Playground(props: {
  rows: VideoCardModel[] | null;
  onClose: () => void;
  onImage: () => void;
  onEntry: (entry: VideoEntry) => void;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const rows = props.rows;
  return (
    <div
      className="pm-playground"
      role="dialog"
      aria-modal="true"
      aria-label={t("video.title")}
    >
      <div className="pm-playground-inner">
        <header className="pm-playground-head">
          <h1>{t("video.title")}</h1>
          <button type="button" onClick={props.onClose}>
            {t("video.close")}
          </button>
        </header>
        <div className="pm-video-grid">
          <button
            type="button"
            className="pm-video-card"
            onClick={props.onImage}
          >
            {t("video.imageGen")}
          </button>
          <button
            type="button"
            className="pm-video-card"
            onClick={() => props.onEntry("ref")}
          >
            {t("video.imageToVideo")}
          </button>
          <button
            type="button"
            className="pm-video-card"
            onClick={() => props.onEntry("frames")}
          >
            {t("video.frames")}
          </button>
          <button
            type="button"
            className="pm-video-card"
            onClick={() => props.onEntry("custom")}
          >
            {t("video.custom")}
          </button>
        </div>
        <div className="pm-video-history-head">
          <h2>{t("video.history")}</h2>
          {!!rows?.length && (
            <button type="button" onClick={props.onClear}>
              {t("video.clear")}
            </button>
          )}
        </div>
        {rows === null ? null : rows.length === 0 ? (
          <p className="pm-video-empty">{t("video.empty")}</p>
        ) : (
          <div className="pm-video-history">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="pm-video-tile"
                onClick={() => props.onOpen(row.id)}
              >
                {row.coverUrl ? (
                  <img src={row.coverUrl} alt="" />
                ) : (
                  <span className="pm-video-tile-empty" />
                )}
                <span className={"pm-video-badge " + row.status}>
                  {t(`video.status.${row.status}`)}
                </span>
                <span className="pm-video-tile-meta">
                  <b>{row.meta}</b>
                  <span>{row.prompt}</span>
                  {row.error && <span className="err">{row.error}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
