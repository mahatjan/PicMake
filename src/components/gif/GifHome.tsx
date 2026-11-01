/** GIF 首页：导入视频/GIF/图片、最近项目。纯展示。 */
import { useTranslation } from "react-i18next";
import { Film, FolderOpen, ImagePlus, Images, Trash2, X } from "lucide-react";
import { fmtDuration } from "../../lib/format";
import { fmtTime } from "../../i18n/format";
import type { GifImportJob } from "../../store/workspace";

export interface GifHomeRow {
  id: string;
  title: string;
  updatedAt: number;
  frames: number;
  duration: number;
  thumbUrl: string | null;
}

export function GifHome(props: {
  rows: GifHomeRow[] | null;
  importJob: GifImportJob | null;
  onImport: (kind: "video" | "gif" | "image") => void;
  onPickWork: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="pm-gif pm-gif-home" role="dialog" aria-modal="true">
      <header className="pm-gif-home-head">
        <div>
          <h1>{t("gif.title")}</h1>
          <p>{t("gif.homeHint")}</p>
        </div>
        <button
          type="button"
          className="pm-gif-iconbtn"
          aria-label={t("gif.close")}
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
      </header>

      <section className="pm-gif-create">
        <div className="pm-gif-create-title">
          <span>{t("gif.create")}</span>
          <small>10 FPS</small>
        </div>
        <div className="pm-gif-create-grid">
          <button type="button" onClick={() => props.onImport("video")}>
            <Film size={20} />
            <span>{t("gif.importVideo")}</span>
          </button>
          <button type="button" onClick={() => props.onImport("gif")}>
            <Images size={20} />
            <span>{t("gif.importGif")}</span>
          </button>
          <button type="button" onClick={() => props.onImport("image")}>
            <ImagePlus size={20} />
            <span>{t("gif.importImage")}</span>
          </button>
        </div>
        <button
          type="button"
          className="pm-gif-create-alt"
          onClick={props.onPickWork}
        >
          <FolderOpen size={16} />
          <span>{t("gif.importWork")}</span>
        </button>
        {props.importJob && (
          <div className="pm-gif-importing" role="status">
            <span>
              {props.importJob.status === "error" && props.importJob.error
                ? (t as (key: string) => string)(
                    `gif.issue.${props.importJob.error}`,
                  )
                : t("gif.importing", { name: props.importJob.name })}
            </span>
            <i
              style={{
                width:
                  props.importJob.status === "error"
                    ? "100%"
                    : `${Math.round(props.importJob.progress * 100)}%`,
              }}
            />
          </div>
        )}
      </section>

      <section className="pm-gif-recent">
        <header>
          <h2>{t("gif.recent")}</h2>
          {!!props.rows?.length && (
            <button type="button" onClick={props.onClear}>
              {t("gif.clear")}
            </button>
          )}
        </header>
        {props.rows === null ? (
          <p className="pm-gif-empty">…</p>
        ) : props.rows.length === 0 ? (
          <div className="pm-gif-empty">
            <b>{t("gif.empty")}</b>
            <span>{t("gif.emptyHint")}</span>
          </div>
        ) : (
          <ul className="pm-gif-projects">
            {props.rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="pm-gif-project"
                  onClick={() => props.onOpen(row.id)}
                >
                  <span className="pm-gif-project-thumb">
                    {row.thumbUrl ? (
                      <img src={row.thumbUrl} alt="" />
                    ) : (
                      <span />
                    )}
                  </span>
                  <span className="pm-gif-project-meta">
                    <b>{row.title || t("gif.untitled")}</b>
                    <span>
                      {t("gif.timeline.frameCount", { count: row.frames })} ·{" "}
                      {fmtDuration(row.duration)} ·{" "}
                      {fmtTime(row.updatedAt, i18n)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="pm-gif-project-del"
                  aria-label={t("gif.delete")}
                  onClick={() => props.onDelete(row.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
