/** 作品选择：挑一张已保存的作品作为 GIF 素材源。纯展示。 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

export interface GifWorkItem {
  id: string;
  url: string | null;
  width: number;
  height: number;
  prompt: string;
}

export function GifAssetPicker(props: {
  items: GifWorkItem[];
  loading: boolean;
  onPick: (id: string) => void;
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
        className="pm-gif-sheet pm-gif-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gif-picker-title"
      >
        <header className="pm-gif-sheet-head">
          <div>
            <h2 id="gif-picker-title">{t("gif.work.title")}</h2>
            <p>{t("gif.work.hint")}</p>
          </div>
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.close")}
            onClick={props.onClose}
          >
            <X size={17} />
          </button>
        </header>
        {props.loading ? (
          <p className="pm-gif-sheet-empty">{t("gif.work.loading")}</p>
        ) : props.items.length === 0 ? (
          <p className="pm-gif-sheet-empty">{t("gif.work.empty")}</p>
        ) : (
          <div className="pm-gif-picker-grid">
            {props.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="pm-gif-picker-item"
                onClick={() => props.onPick(item.id)}
              >
                <span className="pm-gif-picker-thumb">
                  {item.url ? <img src={item.url} alt="" /> : <span />}
                </span>
                <span className="pm-gif-picker-meta">
                  {item.prompt || t("gif.work.untitled")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
