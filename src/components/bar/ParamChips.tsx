/** 参数 chips：模型、比例与基准、质量、张数、更多设置；各自带弹层，开合为内部状态 */
import { useTranslation } from "react-i18next";
import { modelSuffix, ratioLabel, sizeChipValue } from "../../i18n/labels";
import {
  BASE_LABELS,
  DEFAULT_FORM,
  MAX_MULTI_RATIOS,
  MODEL_LABELS,
  RATIOS,
  formSize,
  formSizes,
  isCustomActive,
  isMultiSize,
  multiPatch,
  toggleRatioPatch,
  type GenForm,
} from "../../lib/params";
import { SIZE_LIMITS } from "../../lib/size";
import { ratioMismatch } from "../../lib/sketch";
import type { FidelityChoice, OutputFormat, Quality } from "../../lib/types";
import { Segmented, Switch } from "../controls";
import { BarChip, PopRow } from "./BarChip";

const QUALITIES: ReadonlyArray<Quality> = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function ParamChips(props: {
  form: GenForm;
  customValid: boolean;
  /** 已确认草图的逻辑尺寸；无草图为 null */
  sketchSize: { w: number; h: number } | null;
  /** 有输入图（编辑态）：「保留原图」才有意义 */
  editing: boolean;
  hasSketch: boolean;
  /** 局部重绘草稿：输出尺寸由选区决定，不支持多比例 */
  multiDisabled: boolean;
  inputFidelity: FidelityChoice;
  onPatch: (patch: Partial<GenForm>) => void;
  onInputFidelity: (value: FidelityChoice) => void;
}) {
  const { t } = useTranslation();
  const { form: f, editing, hasSketch, onPatch } = props;
  const usingCustom = isCustomActive(f);
  const explicitSize = formSize(f);
  // 多个比例时，任一比例与草图不一致都提示
  const checkedSizes =
    formSizes(f) ?? (explicitSize === "auto" ? [] : [explicitSize]);
  const sketchSize = props.sketchSize;
  const sizeMismatch =
    !!sketchSize &&
    checkedSizes.some((size) => ratioMismatch(size, sketchSize));
  // 至少 2 个比例才是多尺寸：每个比例 1 张，张数 chip 不可用
  const countLocked = isMultiSize(f);
  const ratiosFull = f.multi && f.ratios.length >= MAX_MULTI_RATIOS;
  return (
    <>
      <BarChip
        ariaLabel={t("params.model")}
        value={MODEL_LABELS[f.model]}
        suffix={modelSuffix(f.model, t) ?? undefined}
        dirty={f.model !== DEFAULT_FORM.model}
        closeOnSelect
      >
        <PopRow
          selected={f.model === "flare"}
          name={t("params.modelFlare")}
          desc={t("params.modelFlareDesc")}
          onClick={() => onPatch({ model: "flare" })}
        />
        <PopRow
          selected={f.model === "sunburst"}
          name={t("params.modelSunburst")}
          desc={t("params.modelSunburstDesc")}
          onClick={() => onPatch({ model: "sunburst" })}
        />
        <PopRow
          selected={f.model === "gpt2"}
          name={t("params.modelGpt2")}
          desc={t("params.modelGpt2Desc")}
          onClick={() => onPatch({ model: "gpt2" })}
        />
      </BarChip>

      <BarChip
        ariaLabel={t("params.ratioAndBase")}
        value={sizeChipValue(f, t)}
        dirty={
          f.multi ||
          f.ratio !== DEFAULT_FORM.ratio ||
          f.base !== DEFAULT_FORM.base ||
          usingCustom
        }
        popWidth={252}
      >
        <div className="pm-pop-head">
          <p className="pm-pop-lb">{t("params.ratio")}</p>
          <span className="pm-pop-multi">
            {t("params.multi")}
            <Switch
              checked={f.multi}
              disabled={props.multiDisabled}
              ariaLabel={t("params.multi")}
              onChange={(on) => onPatch(multiPatch(f, on))}
            />
          </span>
        </div>
        <div className="pm-pop-ratio">
          {RATIOS.map((id) => {
            const preset = id !== "auto";
            const on = f.multi
              ? preset && f.ratios.includes(id)
              : !usingCustom && f.ratio === id;
            return (
              <button
                key={id}
                type="button"
                className={on ? "on" : ""}
                aria-pressed={on}
                // 多比例下「自动」不可用；选满后其余比例不可选
                disabled={f.multi && (!preset || (!on && ratiosFull))}
                onClick={() => {
                  if (!f.multi) return onPatch({ ratio: id, cw: "", ch: "" });
                  const patch = preset ? toggleRatioPatch(f, id) : null;
                  if (patch) onPatch(patch);
                }}
              >
                {ratioLabel(id, t)}
              </button>
            );
          })}
        </div>
        {ratiosFull && (
          <p className="pm-pop-hint" role="status">
            {t("params.multiMax", { max: MAX_MULTI_RATIOS })}
          </p>
        )}
        {props.multiDisabled && (
          <p className="pm-pop-hint">{t("params.multiInpaint")}</p>
        )}
        <p className="pm-pop-lb">{t("params.baseRes")}</p>
        <Segmented
          full
          ariaLabel={t("params.baseRes")}
          value={f.base}
          disabled={!f.multi && (f.ratio === "auto" || usingCustom)}
          onChange={(base) => onPatch({ base })}
          options={BASE_LABELS.map((b) => ({ value: b.id, label: b.label }))}
        />
        <p className="pm-pop-lb">{t("params.custom")}</p>
        <div className="pm-pop-wh">
          <input
            type="number"
            min={256}
            max={3840}
            step={16}
            placeholder={t("params.widthPlaceholder")}
            aria-label={t("params.customWidth")}
            disabled={f.multi}
            value={f.cw}
            className={props.customValid ? "" : "bad"}
            onChange={(e) => onPatch({ cw: e.target.value })}
          />
          <span>×</span>
          <input
            type="number"
            min={256}
            max={3840}
            step={16}
            placeholder={t("params.heightPlaceholder")}
            aria-label={t("params.customHeight")}
            disabled={f.multi}
            value={f.ch}
            className={props.customValid ? "" : "bad"}
            onChange={(e) => onPatch({ ch: e.target.value })}
          />
          <span>px</span>
        </div>
        {f.multi ? (
          <>
            <p className="pm-pop-hint">{t("params.multiHint")}</p>
            <p className="pm-pop-hint">{t("params.multiDiffer")}</p>
          </>
        ) : (
          <>
            <p className="pm-pop-hint">
              {t("params.sizeHint", {
                long: SIZE_LIMITS.long,
                short: SIZE_LIMITS.short,
              })}
            </p>
            <p className="pm-pop-hint">{t("params.sketchSizeHint")}</p>
          </>
        )}
        {sizeMismatch && (
          <p className="pm-pop-hint warn" role="status">
            {t("params.sketchMismatch")}
          </p>
        )}
      </BarChip>

      <BarChip
        ariaLabel={t("params.quality")}
        value={t(`params.qualityLevel.${f.quality}`)}
        suffix={t("params.quality")}
        dirty={f.quality !== DEFAULT_FORM.quality}
        closeOnSelect
      >
        {QUALITIES.map((id) => (
          <PopRow
            key={id}
            selected={f.quality === id}
            name={t(`params.qualityLevel.${id}`)}
            desc={t(`params.qualityDesc.${id}`)}
            onClick={() => onPatch({ quality: id })}
          />
        ))}
      </BarChip>

      <BarChip
        ariaLabel={t("params.count")}
        // 多比例时总张数 = 比例数，不能改
        value={`×${countLocked ? f.ratios.length : f.n}`}
        dirty={!countLocked && f.n !== DEFAULT_FORM.n}
        disabled={countLocked}
        title={countLocked ? t("params.countLocked") : undefined}
        popWidth={196}
        closeOnSelect
      >
        <div className="pm-pop-n">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={f.n === n ? "on" : ""}
              onClick={() => onPatch({ n })}
            >
              ×{n}
            </button>
          ))}
        </div>
        <p className="pm-pop-hint">{t("params.countHint")}</p>
      </BarChip>

      <BarChip
        ariaLabel={t("params.more")}
        icon={<span className="pm-chip-icon-txt">⋯</span>}
        right
        popWidth={252}
      >
        <p className="pm-pop-lb">{t("params.background")}</p>
        <Segmented
          full
          ariaLabel={t("params.background")}
          value={f.bg}
          onChange={(bg) =>
            onPatch(
              bg === "transparent" && f.fmt === "jpeg"
                ? ({ bg, fmt: "png" } as Partial<GenForm>)
                : { bg },
            )
          }
          options={[
            { value: "auto", label: t("params.backgroundLevel.auto") },
            {
              value: "transparent",
              label: t("params.backgroundLevel.transparent"),
            },
            { value: "opaque", label: t("params.backgroundLevel.opaque") },
          ]}
        />
        <p className="pm-pop-lb">{t("params.format")}</p>
        <Segmented
          full
          ariaLabel={t("params.format")}
          value={f.fmt}
          onChange={(fmt) => onPatch({ fmt })}
          options={
            f.bg === "transparent"
              ? ([
                  { value: "png", label: "PNG" },
                  { value: "webp", label: "WebP" },
                ] as Array<{ value: OutputFormat; label: string }>)
              : ([
                  { value: "png", label: "PNG" },
                  { value: "jpeg", label: "JPEG" },
                  { value: "webp", label: "WebP" },
                ] as Array<{ value: OutputFormat; label: string }>)
          }
        />
        {editing && (
          <>
            <p className="pm-pop-lb">{t("params.keepOriginal")}</p>
            <Segmented<FidelityChoice>
              full
              ariaLabel={t("params.keepOriginal")}
              value={props.inputFidelity}
              onChange={props.onInputFidelity}
              options={[
                { value: "auto", label: t("common.auto") },
                { value: "low", label: t("params.fidelityLow") },
                { value: "high", label: t("params.fidelityHigh") },
              ]}
            />
            <p className="pm-pop-hint">{t("params.fidelityHint")}</p>
            {hasSketch && (
              <p className="pm-pop-hint">{t("params.fidelitySketchHint")}</p>
            )}
          </>
        )}
      </BarChip>
    </>
  );
}
