/** 底部创作条：mini / full / generating / complete 四态，纯展示；弹层开合为内部状态。
 *  generating 态是"进度 + 输入"，草稿可继续提交独立任务 */
import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Paperclip, Pencil, Plus, RotateCcw } from "lucide-react";
import { sizeReasonText, uploadIssueText } from "../../i18n/labels";
import { type GenForm } from "../../lib/params";
import type {
  DisplayGen,
  DisplayInput,
  InpaintBarInfo,
} from "../../lib/view-models";
import type { FidelityChoice, ModelId, UploadIssue } from "../../lib/types";
import { MAX_INPUT_IMAGES } from "../../lib/types";
import { BarChip } from "./BarChip";

import { InputThumbs } from "./InputThumbs";
import { MiniBar } from "./MiniBar";
import { GenBar } from "./GenBar";
import { DoneBar } from "./DoneBar";
import { ParamChips } from "./ParamChips";

/** ── full 态：附件 + 输入 + 参数 chips ── */
interface FullBarProps {
  form: GenForm;
  customValid: boolean;
  images: DisplayInput[];
  inputFidelity: FidelityChoice;
  reading: boolean;
  /** 上传读取阶段的提示 */
  uploadIssues: UploadIssue[];
  canReturn: boolean;
  /** 已确认草图的逻辑尺寸；无草图为 null */
  sketchSize: { w: number; h: number } | null;
  /** 局部重绘投影；无选区为 null */
  inpaint: InpaintBarInfo | null;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  onPatch: (patch: Partial<GenForm>) => void;
  onGenerate: () => void;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onPreview: (id: string) => void;
  /** 打开新画板 */
  onOpenSketch: () => void;
  /** 点击草图缩略图重新打开画板 */
  onEditSketch: (id: string) => void;
  onInputFidelity: (value: FidelityChoice) => void;
  onReturn: () => void;
  /** 发起局部重绘（普通图片 ✎） */
  onStartInpaint: (id: string) => void;
  /** 修改已确认选区（底图 ✎） */
  onEditMask: () => void;
  /** 移除选区：保留底图与描述，切换为普通图片编辑 */
  onRemoveMask: () => void;
  /** 接受建议输出尺寸 */
  onAcceptSize: () => void;
}

function FullBar(props: FullBarProps) {
  const { t } = useTranslation();
  const { form: f, onPatch } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = props.images.length > 0;
  const sketchIdx = props.images.findIndex((image) => image.isSketch);
  const hasSketch = sketchIdx >= 0;
  const atMax = props.images.length >= MAX_INPUT_IMAGES;
  const inpaint = props.inpaint;
  const sizeBlocked = !!inpaint?.suggested && !inpaint.accepted;
  const ready = !props.reading && !sizeBlocked && f.prompt.trim().length > 0;
  const blockTitle = sizeBlocked ? t("bar.sizeBlocked") : undefined;
  // 窄屏输入框随内容增高，离开 full 态即卸下监听并清掉行内高度
  useEffect(() => {
    const el = props.promptRef.current;
    if (!el) return;
    const mq = window.matchMedia("(max-width: 760px)");
    const fit = () => {
      if (!mq.matches || !el.value) {
        el.style.height = "";
        return;
      }
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    mq.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    return () => {
      mq.removeEventListener("change", fit);
      window.removeEventListener("resize", fit);
      el.style.height = "";
    };
  }, [f.prompt, props.promptRef]);
  return (
    <div className="pm-bar-full">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        hidden
        disabled={props.reading}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) props.onFiles(files);
        }}
      />
      {editing && (
        <InputThumbs
          images={props.images}
          reading={props.reading}
          inpaint={inpaint}
          onRemove={props.onRemove}
          onPreview={props.onPreview}
          onEditSketch={props.onEditSketch}
          onStartInpaint={props.onStartInpaint}
          onEditMask={props.onEditMask}
          onRemoveMask={props.onRemoveMask}
        />
      )}
      {inpaint?.suggested && (
        <div className="pm-bar-size" role="status">
          <span>{t("bar.sizeDiffers")}</span>
          <b>
            {inpaint.tw} × {inpaint.th}
          </b>
          <span className="why">{sizeReasonText(inpaint.reason, t)}</span>
          {inpaint.accepted ? (
            <span className="ok">{t("bar.sizeAccepted")}</span>
          ) : (
            <button type="button" onClick={props.onAcceptSize}>
              {t("bar.acceptSize")}
            </button>
          )}
        </div>
      )}
      {props.uploadIssues.length > 0 && (
        <p className="pm-bar-err" role="alert">
          {props.uploadIssues
            .map((issue) => uploadIssueText(issue, t))
            .join("\n")}
        </p>
      )}
      <div className="pm-bar-row1">
        <textarea
          ref={props.promptRef}
          className="pm-bar-ta"
          aria-label={
            inpaint || editing ? t("bar.editLabel") : t("bar.promptLabel")
          }
          maxLength={32000}
          value={f.prompt}
          placeholder={
            inpaint
              ? t("bar.placeholderInpaint")
              : hasSketch
                ? t("bar.placeholderSketch", { index: sketchIdx + 1 })
                : editing
                  ? t("bar.placeholderEdit")
                  : t("bar.placeholder")
          }
          disabled={props.reading}
          rows={1}
          onChange={(e) => onPatch({ prompt: e.target.value })}
        />
        <button
          type="button"
          className={"pm-bar-send" + (ready ? " ready" : "")}
          aria-label={
            inpaint
              ? t("bar.sendInpaint")
              : hasSketch
                ? t("bar.sendSketch")
                : editing
                  ? t("bar.sendEdit")
                  : t("bar.send")
          }
          title={blockTitle}
          disabled={!ready}
          onClick={props.onGenerate}
        >
          <ArrowUp size={16} strokeWidth={2.4} />
        </button>
      </div>
      {inpaint && <p className="pm-bar-inp-note">{t("bar.inpaintNote")}</p>}
      <div className="pm-bar-row2">
        {props.canReturn && (
          <button
            type="button"
            className="pm-chip pm-chip-return"
            onClick={props.onReturn}
          >
            <RotateCcw size={11} />
            {t("bar.returnToResult")}
          </button>
        )}
        <BarChip
          ariaLabel={t("bar.addInput")}
          icon={<Plus size={13} />}
          disabled={props.reading}
          popWidth={252}
          closeOnSelect
        >
          <button
            type="button"
            className="pm-pop-opt with-ic"
            disabled={atMax}
            onClick={() => fileRef.current?.click()}
          >
            <span className="ic">
              <Paperclip size={14} />
            </span>
            <span className="tx">
              <span className="nm">{t("bar.upload")}</span>
              <span className="ds">
                {t("bar.uploadDesc", { max: MAX_INPUT_IMAGES })}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="pm-pop-opt with-ic"
            disabled={!hasSketch && atMax}
            onClick={props.onOpenSketch}
          >
            <span className="ic">
              <Pencil size={14} />
            </span>
            <span className="tx">
              <span className="nm">
                {hasSketch ? t("bar.continueSketch") : t("bar.drawSketch")}
              </span>
              <span className="ds">
                {hasSketch
                  ? t("bar.continueSketchDesc")
                  : atMax
                    ? t("bar.atMax", { max: MAX_INPUT_IMAGES })
                    : t("bar.drawSketchDesc")}
              </span>
            </span>
          </button>
        </BarChip>
        <ParamChips
          form={f}
          customValid={props.customValid}
          sketchSize={props.sketchSize}
          editing={editing}
          hasSketch={hasSketch}
          multiDisabled={!!inpaint}
          inputFidelity={props.inputFidelity}
          onPatch={onPatch}
          onInputFidelity={props.onInputFidelity}
        />
      </div>
    </div>
  );
}

/** 底栏总装：状态优先级 generating > complete > (full > mini)。生成中在进度行下面照常给出输入，
 *  子节点按固定次序占位，生成开始与结束都不重新挂载 FullBar（否则正在输入的描述会失焦） */
export function CreateBar(
  props: FullBarProps & {
    mode: "mini" | "full";
    generating: boolean;
    generatingModel: ModelId;
    activeCount: number;
    done: DisplayGen | null;
    partialIndex: number | null;
    /** 多尺寸生成中已完成的请求数与总数；单尺寸为 null */
    progress: { done: number; total: number } | null;
    onCancel: () => void;
    onExpand: () => void;
    onAgain: () => void;
    onTweak: () => void;
    onDownloadAll: () => void;
    onUseAsRef: () => void;
    /** 根节点，供容器量创作条高度 */
    barRef: RefObject<HTMLElement | null>;
  },
) {
  const {
    mode,
    generating,
    generatingModel,
    done,
    partialIndex,
    progress,
    activeCount,
    onCancel,
    onExpand,
    onAgain,
    onTweak,
    onDownloadAll,
    onUseAsRef,
    barRef,
    ...full
  } = props;
  const { t } = useTranslation();
  const state = generating ? "generating" : done ? "complete" : mode;
  return (
    <section
      ref={barRef}
      className="pm-island pm-bar"
      aria-label={t("bar.label")}
      data-state={state}
    >
      {generating && (
        <GenBar
          model={generatingModel}
          partialIndex={partialIndex}
          progress={progress}
          activeCount={activeCount}
          onCancel={onCancel}
        />
      )}
      {(generating || mode === "full") && <FullBar {...full} />}
      {state === "mini" && (
        <MiniBar form={full.form} disabled={full.reading} onExpand={onExpand} />
      )}
      {state === "complete" && done && (
        <DoneBar
          done={done}
          onAgain={onAgain}
          onTweak={onTweak}
          onDownloadAll={onDownloadAll}
          onUseAsRef={onUseAsRef}
          onDismiss={onExpand}
        />
      )}
    </section>
  );
}
