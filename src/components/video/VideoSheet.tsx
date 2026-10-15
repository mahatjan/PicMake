/** 视频表单：参考图、首尾帧、自定义流程共用。纯展示。 */
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, X } from "lucide-react";
import type { VideoEntry, VideoInputMode } from "../../lib/video";

export interface VideoThumb {
  id: string;
  name: string;
  url: string | null;
}

export function VideoSheet(props: {
  entry: VideoEntry;
  prompt: string;
  promptMax: number;
  duration: string;
  durationMax: number;
  workflowId: string;
  workflowOptions: { id: string; label: string }[];
  customWorkflowId: string;
  customInput: VideoInputMode;
  resolution: string;
  resolutions: string[];
  seed: string;
  refs: VideoThumb[];
  refMax: number;
  frames: { first: VideoThumb | null; last: VideoThumb | null };
  submitting: boolean;
  onPrompt: (value: string) => void;
  onDuration: (value: string) => void;
  onWorkflow: (id: string) => void;
  onCustomId: (value: string) => void;
  onCustomInput: (mode: VideoInputMode) => void;
  onResolution: (value: string) => void;
  onSeed: (value: string) => void;
  onFiles: (files: File[]) => void;
  onRemoveRef: (id: string) => void;
  onClearRefs: () => void;
  onRemoveFrame: (slot: "first" | "last") => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const frames =
    props.entry === "frames" ||
    (props.entry === "custom" && props.customInput === "frames");
  const subtitle =
    props.entry === "custom" ? props.customWorkflowId.trim() : props.workflowId;
  const pick = (slot: "first" | "last" | "refs") => {
    const input = fileRef.current;
    if (!input) return;
    input.multiple = slot === "refs";
    input.value = "";
    input.click();
  };
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
        aria-labelledby="video-sheet-title"
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (!files.length) return;
          event.preventDefault();
          props.onFiles(files);
        }}
      >
        <header className="pm-video-head">
          <div className="pm-video-head-text">
            <h2 id="video-sheet-title">{t(`video.entry.${props.entry}`)}</h2>
            {subtitle && <p>{subtitle}</p>}
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
          {frames ? (
            <div className="pm-frame-row">
              {(["first", "last"] as const).map((slot) => {
                const image = props.frames[slot];
                return (
                  <div key={slot} className="pm-frame-slot">
                    <span>
                      {t(
                        slot === "first"
                          ? "video.firstFrame"
                          : "video.lastFrame",
                      )}
                    </span>
                    <div className="pm-frame-well">
                      <button type="button" onClick={() => pick(slot)}>
                        {image?.url ? (
                          <img src={image.url} alt={image.name} />
                        ) : (
                          <>
                            <Plus size={16} aria-hidden="true" />
                            {t("video.upload")}
                          </>
                        )}
                      </button>
                      {image && (
                        <button
                          type="button"
                          className="pm-video-thumb-x"
                          aria-label={t("video.remove")}
                          onClick={() => props.onRemoveFrame(slot)}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <section className="pm-ref-block">
              <div className="pm-ref-head">
                <span>{t("video.refs")}</span>
                <span>
                  {t("video.refsHint", {
                    count: props.refs.length,
                    max: props.refMax,
                  })}
                </span>
                {!!props.refs.length && (
                  <button type="button" onClick={props.onClearRefs}>
                    {t("video.clearRefs")}
                  </button>
                )}
              </div>
              <div className="pm-ref-row">
                {props.refs.map((ref) => (
                  <figure key={ref.id}>
                    {ref.url ? (
                      <img src={ref.url} alt={ref.name} title={ref.name} />
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="pm-video-thumb-x"
                      aria-label={t("video.remove")}
                      onClick={() => props.onRemoveRef(ref.id)}
                    >
                      <X size={12} />
                    </button>
                  </figure>
                ))}
                <button
                  type="button"
                  className={"pm-ref-add" + (props.refs.length ? "" : " wide")}
                  aria-label={t("video.addRefs")}
                  onClick={() => pick("refs")}
                >
                  <Plus size={16} aria-hidden="true" />
                  {props.refs.length ? null : t("video.addRefs")}
                </button>
              </div>
            </section>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length) props.onFiles(files);
            }}
          />

          <label className="pm-video-label" htmlFor="video-prompt">
            {t("video.prompt")}
          </label>
          <textarea
            id="video-prompt"
            className="pm-video-text"
            maxLength={props.promptMax}
            placeholder={t("video.promptPlaceholder")}
            value={props.prompt}
            onChange={(event) => props.onPrompt(event.target.value)}
          />
          <p className="pm-video-count">
            {t("video.count", {
              count: props.prompt.length,
              max: props.promptMax,
            })}
          </p>

          <div className="pm-video-fields">
            <Field
              id="video-duration"
              label={t("video.duration", { max: props.durationMax })}
            >
              <input
                id="video-duration"
                className="pm-video-input"
                inputMode="numeric"
                value={props.duration}
                onChange={(event) => props.onDuration(event.target.value)}
              />
            </Field>
            <SelectField
              id="video-resolution"
              label={t("video.resolution")}
              value={props.resolution}
              onChange={props.onResolution}
            >
              {props.resolutions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>

            {props.entry === "ref" && (
              <SelectField
                id="video-workflow"
                className="pm-video-span"
                label={t("video.workflow")}
                value={props.workflowId}
                onChange={props.onWorkflow}
              >
                {props.workflowOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            )}
            {props.entry === "custom" && (
              <>
                <Field
                  id="video-custom-id"
                  className="pm-video-span"
                  label={t("video.workflowId")}
                >
                  <input
                    id="video-custom-id"
                    className="pm-video-input"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("video.workflowPlaceholder")}
                    value={props.customWorkflowId}
                    onChange={(event) => props.onCustomId(event.target.value)}
                  />
                </Field>
                <SelectField
                  id="video-mode"
                  className="pm-video-span"
                  label={t("video.inputMode")}
                  value={props.customInput}
                  onChange={(value) =>
                    props.onCustomInput(value === "frames" ? "frames" : "refs")
                  }
                >
                  <option value="refs">{t("video.modeRefs")}</option>
                  <option value="frames">{t("video.modeFrames")}</option>
                </SelectField>
              </>
            )}

            <Field
              id="video-seed"
              className="pm-video-span"
              label={t("video.seed")}
            >
              <input
                id="video-seed"
                className="pm-video-input"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={props.seed}
                onChange={(event) => props.onSeed(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <footer className="pm-video-foot">
          <button
            type="button"
            className="pm-video-submit"
            disabled={props.submitting}
            onClick={props.onSubmit}
          >
            {t("video.submit")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field(props: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={props.className}>
      <label className="pm-video-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

function SelectField(props: {
  id: string;
  label: string;
  value: string;
  className?: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Field id={props.id} label={props.label} className={props.className}>
      <div className="pm-video-select">
        <select
          id={props.id}
          className="pm-video-input"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.children}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </div>
    </Field>
  );
}
