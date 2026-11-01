/** 选帧面板：按采样帧率展示缩略图，勾选/抽帧/反选。纯展示。 */
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { GifProject } from "../../lib/gif/types";
import type { GifThumb } from "../../hooks/useGifThumbs";

export function GifFrameSheet(props: {
  project: GifProject;
  thumbs: GifThumb[];
  loading: boolean;
  selected: Set<number>;
  total: number;
  onToggle: (index: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onInvert: () => void;
  onSample: (every: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="pm-gif-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className="pm-gif-sheet pm-gif-framesheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gif-frames-title"
      >
        <header className="pm-gif-sheet-head">
          <div>
            <h2 id="gif-frames-title">{t("gif.frames.title")}</h2>
            <p>{t("gif.frames.hint")}</p>
          </div>
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.frames.apply")}
            onClick={props.onClose}
          >
            <X size={17} />
          </button>
        </header>
        <div className="pm-gif-frames-actions">
          <button type="button" onClick={props.onSelectAll}>
            {t("gif.frames.selectAll")}
          </button>
          <button type="button" onClick={props.onClear}>
            {t("gif.frames.clear")}
          </button>
          <button type="button" onClick={props.onInvert}>
            {t("gif.frames.invert")}
          </button>
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" onClick={() => props.onSample(n)}>
              {t("gif.frames.every", { n })}
            </button>
          ))}
          <span className="pm-gif-frames-count">
            {t("gif.frames.selected", {
              count: props.selected.size,
              total: props.total,
            })}
          </span>
        </div>
        {props.loading ? (
          <p className="pm-gif-sheet-empty">{t("gif.frames.loading")}</p>
        ) : props.thumbs.length === 0 ? (
          <p className="pm-gif-sheet-empty">{t("gif.frames.empty")}</p>
        ) : (
          <div className="pm-gif-frame-grid">
            {props.thumbs.map((thumb, index) => {
              const checked = props.selected.has(index);
              return (
                <button
                  key={thumb.index}
                  type="button"
                  className={"pm-gif-frame" + (checked ? " is-on" : "")}
                  aria-pressed={checked}
                  onClick={() => props.onToggle(index)}
                >
                  <img src={thumb.url} alt="" />
                  <span className="pm-gif-frame-no">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="pm-gif-frame-check">
                    {checked && <Check size={12} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <footer className="pm-gif-sheet-foot">
          <button
            type="button"
            className="pm-gif-primary"
            onClick={props.onClose}
          >
            {t("gif.frames.apply")}
          </button>
        </footer>
      </div>
    </div>
  );
}
