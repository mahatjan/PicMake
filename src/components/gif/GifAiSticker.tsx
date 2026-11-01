/** AI 贴纸：写一句描述，生成一张贴纸图作为图层。纯展示。 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";

export function GifAiSticker(props: {
  busy: boolean;
  onGenerate: (prompt: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const ready = prompt.trim().length > 0 && !props.busy;
  return (
    <div
      className="pm-gif-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.busy)
          props.onClose();
      }}
    >
      <div
        className="pm-gif-sheet pm-gif-sticker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gif-sticker-title"
      >
        <header className="pm-gif-sheet-head">
          <div>
            <h2 id="gif-sticker-title">{t("gif.sticker.title")}</h2>
            <p>{t("gif.sticker.hint")}</p>
          </div>
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.export.close")}
            onClick={props.onClose}
            disabled={props.busy}
          >
            <X size={17} />
          </button>
        </header>
        <div className="pm-gif-sticker-body">
          <textarea
            value={prompt}
            rows={3}
            placeholder={t("gif.sticker.placeholder")}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {props.busy && (
            <p className="pm-gif-hint" role="status">
              {t("gif.sticker.generating")}
            </p>
          )}
        </div>
        <footer className="pm-gif-sheet-foot">
          <button
            type="button"
            className="pm-gif-primary"
            disabled={!ready}
            onClick={() => props.onGenerate(prompt.trim())}
          >
            <Sparkles size={14} />
            {t("gif.sticker.generate")}
          </button>
        </footer>
      </div>
    </div>
  );
}
