/** 导出 GIF：循环、尺寸、帧率、颜色数、透明与进度/结果。纯展示。 */
import { useTranslation } from "react-i18next";
import { Download, Share2, X } from "lucide-react";
import { fmtBytes, fmtDuration } from "../../lib/format";
import {
  planGifExport,
  GIF_QUALITY_PRESETS,
  matchQualityPreset,
  type GifQualityPresetId,
} from "../../lib/gif/export-plan";
import {
  exportDimensions,
  exportFrameCount,
  exportFrameIssue,
  outputDuration,
} from "../../lib/gif/timeline";
import type { GifProject } from "../../lib/gif/types";
import type { GifExportJob } from "../../store/workspace";

/** 目标体积档位（字节）；0 = 不限 */
const TARGET_OPTIONS = [
  { bytes: 0, label: "gif.export.targetNone" },
  { bytes: 1024 * 1024, label: "gif.export.target1mb" },
  { bytes: 2 * 1024 * 1024, label: "gif.export.target2mb" },
  { bytes: 5 * 1024 * 1024, label: "gif.export.target5mb" },
] as const;

const PRESET_LABELS = {
  quality: "gif.export.presetQuality",
  balanced: "gif.export.presetBalanced",
  small: "gif.export.presetSmall",
} as const satisfies Record<GifQualityPresetId, string>;

export function GifExportSheet(props: {
  project: GifProject;
  job: GifExportJob | null;
  exportUrl: string | null;
  onPatch: (patch: Partial<GifProject["export"]>) => void;
  onExport: () => void;
  onCancel: () => void;
  onClose: () => void;
  onDownload: () => void;
  onShare: () => void;
  onReset: () => void;
  onAgain: () => void;
}) {
  const { t } = useTranslation();
  const size = exportDimensions(
    props.project.canvas,
    props.project.export.width,
  );
  const frames = exportFrameCount(
    props.project.timeline,
    props.project.export.fps,
  );
  const frameIssue = exportFrameIssue(
    props.project.timeline,
    props.project.export.fps,
  );
  const duration = outputDuration(props.project.timeline);
  const running = props.job?.status === "running";
  const hasResult =
    !running && !!props.project.lastExportAssetId && !!props.exportUrl;
  const targetBytes = props.project.export.targetBytes ?? 0;
  const plan = planGifExport({
    width: size.width,
    height: size.height,
    frames,
    colors: props.project.export.colors,
    targetBytes,
  });
  const oversize =
    targetBytes > 0 &&
    !!props.project.lastExportBytes &&
    props.project.lastExportBytes > targetBytes;
  const downgradeDetail = [
    plan.width !== size.width || plan.height !== size.height
      ? t("gif.export.downgradeSize", {
          from: `${size.width}×${size.height}`,
          to: `${plan.width}×${plan.height}`,
        })
      : "",
    plan.colors !== props.project.export.colors
      ? t("gif.export.downgradeColors", {
          from: props.project.export.colors,
          to: plan.colors,
        })
      : "",
    plan.frameStep > 1
      ? t("gif.export.downgradeFrames", { n: plan.frameStep })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="pm-gif-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) props.onClose();
      }}
    >
      <div
        className="pm-gif-sheet pm-gif-exportsheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gif-export-title"
      >
        <header className="pm-gif-sheet-head">
          <div>
            <h2 id="gif-export-title">{t("gif.export.title")}</h2>
            <p>
              {t("gif.export.frames", { count: frames })} ·{" "}
              {fmtDuration(duration)}
            </p>
          </div>
          <button
            type="button"
            className="pm-gif-iconbtn"
            aria-label={t("gif.export.close")}
            onClick={props.onClose}
            disabled={running}
          >
            <X size={17} />
          </button>
        </header>

        {running ? (
          <div className="pm-gif-export-progress" role="status">
            <p>
              {t("gif.export.exporting", {
                done: props.job?.progress ?? 0,
                total: props.job?.total || frames,
              })}
            </p>
            <i
              style={{
                width: `${
                  props.job?.total
                    ? Math.round((props.job.progress / props.job.total) * 100)
                    : 0
                }%`,
              }}
            />
            <button
              type="button"
              className="pm-gif-mini"
              onClick={props.onCancel}
            >
              {t("gif.export.cancel")}
            </button>
          </div>
        ) : hasResult ? (
          <div className="pm-gif-export-result">
            <img src={props.exportUrl ?? ""} alt="" />
            <p>
              {t("gif.export.sizeValue", {
                w: props.project.lastExportWidth ?? size.width,
                h: props.project.lastExportHeight ?? size.height,
              })}{" "}
              · {fmtBytes(props.project.lastExportBytes ?? 0)} ·{" "}
              {t("gif.export.frames", {
                count: props.project.lastExportFrames ?? frames,
              })}
            </p>
            {oversize && (
              <p className="pm-gif-error">{t("gif.export.oversize")}</p>
            )}
            <div className="pm-gif-export-actions">
              <button type="button" onClick={props.onDownload}>
                <Download size={14} />
                {t("gif.export.download")}
              </button>
              <button type="button" onClick={props.onShare}>
                <Share2 size={14} />
                {t("gif.export.share")}
              </button>
              <button type="button" onClick={props.onReset}>
                {t("gif.export.readjust")}
              </button>
              <button type="button" onClick={props.onAgain}>
                {t("gif.export.again")}
              </button>
              <button type="button" onClick={props.onClose}>
                {t("gif.export.close")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="pm-gif-export-body">
              <label className="pm-gif-field-caption">
                {t("gif.export.loop")}
              </label>
              <div className="pm-gif-seg wide">
                {[1, 2, 3, 5, 0].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={props.project.export.loop === value}
                    onClick={() => props.onPatch({ loop: value })}
                  >
                    {value === 0
                      ? t("gif.export.infinite")
                      : value === 1
                        ? t("gif.export.once")
                        : t("gif.export.times", { n: value })}
                  </button>
                ))}
              </div>

              <label className="pm-gif-field">
                <span>
                  {t("gif.export.width")}
                  <b>
                    {t("gif.export.sizeValue", {
                      w: size.width,
                      h: size.height,
                    })}
                  </b>
                </span>
                <input
                  type="range"
                  min={80}
                  max={960}
                  step={20}
                  value={props.project.export.width}
                  onChange={(event) =>
                    props.onPatch({ width: Number(event.target.value) })
                  }
                />
              </label>

              <div className="pm-gif-row">
                <label className="pm-gif-select">
                  <span>{t("gif.export.fps")}</span>
                  <select
                    value={props.project.export.fps}
                    onChange={(event) =>
                      props.onPatch({ fps: Number(event.target.value) })
                    }
                  >
                    {[5, 10, 12.5, 15, 20, 25].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pm-gif-check">
                  <input
                    type="checkbox"
                    checked={props.project.export.transparent}
                    disabled={
                      props.project.canvas.background.kind !== "transparent"
                    }
                    onChange={(event) =>
                      props.onPatch({ transparent: event.target.checked })
                    }
                  />
                  <span>{t("gif.export.transparent")}</span>
                </label>
              </div>

              <div className="pm-gif-field-caption">
                {t("gif.export.quality")}
              </div>
              <div className="pm-gif-seg wide">
                {GIF_QUALITY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={
                      matchQualityPreset({
                        width: props.project.export.width,
                        colors: props.project.export.colors,
                        targetBytes,
                      }) === preset.id
                    }
                    onClick={() =>
                      props.onPatch({
                        width: preset.width,
                        colors: preset.colors,
                        targetBytes: preset.targetBytes,
                      })
                    }
                  >
                    {t(PRESET_LABELS[preset.id])}
                  </button>
                ))}
              </div>

              <div className="pm-gif-field-caption">
                {t("gif.export.colors")}
              </div>
              <div className="pm-gif-seg wide">
                {[256, 128, 64].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={props.project.export.colors === value}
                    onClick={() => props.onPatch({ colors: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>

              <label className="pm-gif-select">
                <span>{t("gif.export.targetSize")}</span>
                <select
                  value={targetBytes}
                  onChange={(event) =>
                    props.onPatch({ targetBytes: Number(event.target.value) })
                  }
                >
                  {TARGET_OPTIONS.map((option) => (
                    <option key={option.label} value={option.bytes}>
                      {t(option.label)}
                    </option>
                  ))}
                </select>
              </label>

              {targetBytes > 0 && (
                <p className="pm-gif-hint">
                  {t("gif.export.estimated", {
                    size: fmtBytes(plan.estimatedBytes),
                  })}
                  {downgradeDetail
                    ? ` · ${t("gif.export.downgraded", { detail: downgradeDetail })}`
                    : ""}
                </p>
              )}

              {props.job?.status === "error" && props.job.error && (
                <p className="pm-gif-error">
                  {t(`gif.issue.${props.job.error}`)}
                </p>
              )}
              {frameIssue && (
                <p className="pm-gif-error" role="status">
                  {t(`gif.issue.${frameIssue}`)}
                </p>
              )}
            </div>
            <footer className="pm-gif-sheet-foot">
              <button
                type="button"
                className="pm-gif-primary"
                onClick={props.onExport}
                disabled={frameIssue !== null}
              >
                {t("gif.export.start")}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
