/** 结果舞台：空 / 生成中 / 单张 / 网格 / 多尺寸 五形态，纯展示 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import {
  Download,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { DotsWave } from "./DotsWave";
import { errorTitle } from "../i18n/errors";
import { fmtTime } from "../i18n/format";
import { sizeCaption, sizeText } from "../i18n/labels";
import { MODEL_LABELS } from "../lib/params";
import { layoutMulti, multiBox } from "../lib/stage-layout";
import type { SizeSpec } from "../lib/types";
import type {
  DisplayGen,
  DisplayImage,
  DisplaySlot,
  GenPlan,
} from "../lib/view-models";

export function StageEmpty(props: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="pm-empty">
      <div className="pm-empty-glow" aria-hidden="true" />
      <div className="pm-stack" aria-hidden="true">
        <i />
        <i />
        <i />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" />
        </svg>
      </div>
      <h2>{t("stage.emptyTitle")}</h2>
      <p>{t("stage.emptyHint")}</p>
      <Button
        variant="outline"
        className="pm-ghost-cta"
        onPress={props.onStart}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" />
        </svg>
        {t("stage.emptyCta")}
      </Button>
    </div>
  );
}

/** 生成占位卡：点阵在卡内波动；渐进预览到达后在原位淡入，替掉该卡的点阵 */
function GenTile(props: { partialUrl: string | null }) {
  const { t } = useTranslation();
  return (
    <>
      <div
        className={"pm-dots-wave" + (props.partialUrl ? " is-hidden" : "")}
        aria-hidden="true"
      >
        <DotsWave />
      </div>
      {props.partialUrl && (
        <img
          src={props.partialUrl}
          alt={t("stage.generating")}
          className="pm-gen-img"
        />
      )}
    </>
  );
}

export function StageGenerating(props: {
  n: number;
  size: SizeSpec;
  partialUrl: string | null;
  partialIndex: number;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { n, size, partialUrl, partialIndex } = props;
  return (
    <>
      {/* 占位与成品共用同一套布局（pm-single / pm-grid4），完成时图片原位替换点阵 */}
      {n === 1 ? (
        <figure className="pm-single">
          <div
            className="pm-gen-single"
            style={
              size === "auto"
                ? undefined
                : { aspectRatio: `${size.w} / ${size.h}` }
            }
          >
            <GenTile partialUrl={partialUrl} />
          </div>
          {/* 预留说明行高度，完成切换时图片位置不动 */}
          <figcaption className="pm-single-meta pm-reserve" aria-hidden="true">
            &nbsp;
          </figcaption>
        </figure>
      ) : (
        <div className="pm-grid-wrap">
          <div className="pm-grid4" aria-hidden="true">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="pm-gen-tile">
                <GenTile
                  partialUrl={
                    partialUrl && partialIndex === i ? partialUrl : null
                  }
                />
              </div>
            ))}
          </div>
          {/* 预留说明栏高度，完成切换时网格位置不动 */}
          <div className="pm-grid-cap pm-reserve" aria-hidden="true">
            <span>{t("stage.total", { count: n })}</span>
            <Button variant="ghost" size="sm" isDisabled>
              {t("stage.downloadAll")}
            </Button>
            <Button variant="ghost" size="sm" isDisabled>
              {t("stage.reuseAndRegenerate")}
            </Button>
          </div>
        </div>
      )}
      <div className="pm-gen-pill" role="status">
        <span className="pm-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{t("stage.generating")}</span>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label={t("stage.cancel")}
          onPress={props.onCancel}
        >
          <X size={13} />
        </Button>
      </div>
    </>
  );
}

export function StageSingle(props: {
  display: DisplayGen;
  img: DisplayImage;
  onZoom: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { row } = props.display;
  const p = row.params;
  // 多尺寸记录只成功一张时，params.size 可能是失败的那个比例：尺寸取图片的实际宽高
  const size: SizeSpec = p.sizes
    ? { w: props.img.width, h: props.img.height }
    : p.size;
  return (
    <figure className="pm-single">
      <img
        src={props.img.url}
        alt={row.prompt}
        role="button"
        tabIndex={0}
        aria-label={t("stage.zoomAria")}
        onClick={() => props.onZoom(props.img.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onZoom(props.img.id);
          }
        }}
      />
      <figcaption className="pm-single-meta">
        {MODEL_LABELS[p.model]} · {t(`params.qualityLevel.${p.quality}`)} ·{" "}
        {sizeText(size, t)} · {fmtTime(row.createdAt, i18n)}
      </figcaption>
    </figure>
  );
}

export function StageGrid(props: {
  display: DisplayGen;
  onZoomIn: (idx: number) => void;
  onDownload: (idx: number) => void;
  onDownloadAll: () => void;
  onReuse: () => void;
}) {
  const { t } = useTranslation();
  const { row, images } = props.display;
  return (
    <div className="pm-grid-wrap">
      <div className="pm-grid4">
        {images.map((im, idx) => (
          <div
            key={im.id}
            className="pm-gtile"
            role="button"
            tabIndex={0}
            aria-label={t("stage.result", { index: idx + 1 })}
            onClick={() => props.onZoomIn(idx)}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                props.onZoomIn(idx);
              }
            }}
          >
            <img src={im.url} alt={`${row.prompt} ${idx + 1}`} />
            <div className="pm-gtile-acts">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onZoomIn(idx);
                }}
              >
                {t("stage.zoom")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDownload(idx);
                }}
              >
                {t("stage.download")}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="pm-grid-cap">
        {t("stage.total", { count: images.length })}
        <Button variant="ghost" size="sm" onPress={props.onDownloadAll}>
          {t("stage.downloadAll")}
        </Button>
        <Button variant="ghost" size="sm" onPress={props.onReuse}>
          {t("stage.reuseAndRegenerate")}
        </Button>
      </div>
    </div>
  );
}

/* ── 多尺寸：各图保持自身比例、同一行等高，必要时折成两行；生成中的占位与完成后的成品共用排版 ── */

/** 按排版把各格排成一行或两行；cell 画一格（格子 + 下方标注），宽高由排版给出 */
function MultiRows(props: {
  aspects: readonly number[];
  viewport: { w: number; h: number };
  cell: (index: number, width: number, height: number) => ReactNode;
}) {
  const layout = layoutMulti(props.aspects, multiBox(props.viewport));
  return (
    <div className="pm-multi-rows">
      {layout.rows.map((row) => (
        <div key={row.join("-")} className="pm-multi-row">
          {row.map((index) =>
            props.cell(
              index,
              Math.round(props.aspects[index] * layout.height),
              layout.height,
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/** 多尺寸生成中：每格按自己的比例占位，各自显示渐进预览；完成的格子原位显示终稿，失败的格子显示失败标记 */
export function StageMultiGenerating(props: {
  slots: DisplaySlot[];
  viewport: { w: number; h: number };
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { slots } = props;
  const done = slots.filter((slot) => slot.status === "done").length;
  return (
    <>
      <div className="pm-grid-wrap">
        <MultiRows
          aspects={slots.map((slot) => slot.size.w / slot.size.h)}
          viewport={props.viewport}
          cell={(index, width, height) => {
            const slot = slots[index];
            return (
              <div key={index} className="pm-mcell">
                <div
                  className={"pm-gen-tile pm-mtile " + slot.status}
                  style={{ width, height }}
                >
                  {slot.status === "failed" ? (
                    <div className="pm-mfail" role="status">
                      <b>{t("stage.failed")}</b>
                      <span>{errorTitle(slot.failure ?? "unknown", t)}</span>
                    </div>
                  ) : slot.status === "done" && slot.url ? (
                    <img
                      src={slot.url}
                      alt={sizeCaption(slot.size)}
                      className="pm-gen-final"
                    />
                  ) : (
                    <GenTile partialUrl={slot.url} />
                  )}
                </div>
                <span className="pm-mcap">{sizeCaption(slot.size)}</span>
              </div>
            );
          }}
        />
        {/* 预留说明栏高度，完成切换时格子位置不动 */}
        <div className="pm-grid-cap pm-reserve" aria-hidden="true">
          <span>{t("stage.totalSizes", { count: slots.length })}</span>
          <Button variant="ghost" size="sm" isDisabled>
            {t("stage.downloadAll")}
          </Button>
          <Button variant="ghost" size="sm" isDisabled>
            {t("stage.reuseAndRegenerate")}
          </Button>
        </div>
      </div>
      <div className="pm-gen-pill" role="status">
        <span className="pm-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          {t("stage.generatingProgress", { done, total: slots.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label={t("stage.cancel")}
          onPress={props.onCancel}
        >
          <X size={13} />
        </Button>
      </div>
    </>
  );
}

/** 多尺寸结果（2 张及以上）：等高并列，每张下方标注比例与像素；悬浮放大 / 下载，点图弹轮播 */
export function StageMulti(props: {
  display: DisplayGen;
  viewport: { w: number; h: number };
  onZoomIn: (idx: number) => void;
  onDownload: (idx: number) => void;
  onDownloadAll: () => void;
  onReuse: () => void;
}) {
  const { t } = useTranslation();
  const { row, images } = props.display;
  return (
    <div className="pm-grid-wrap">
      <MultiRows
        // 宽高读不到（旧数据为 0）时按 3:2 占位
        aspects={images.map((im) =>
          im.width > 0 && im.height > 0 ? im.width / im.height : 3 / 2,
        )}
        viewport={props.viewport}
        cell={(idx, width, height) => {
          const im = images[idx];
          return (
            <div key={im.id} className="pm-mcell">
              <div
                className="pm-gtile"
                style={{ width, height }}
                role="button"
                tabIndex={0}
                aria-label={t("stage.result", { index: idx + 1 })}
                onClick={() => props.onZoomIn(idx)}
                onKeyDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    props.onZoomIn(idx);
                  }
                }}
              >
                <img src={im.url} alt={`${row.prompt} ${idx + 1}`} />
                <div className="pm-gtile-acts">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onZoomIn(idx);
                    }}
                  >
                    {t("stage.zoom")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDownload(idx);
                    }}
                  >
                    {t("stage.download")}
                  </button>
                </div>
              </div>
              <span className="pm-mcap">
                {sizeCaption({ w: im.width, h: im.height })}
              </span>
            </div>
          );
        }}
      />
      <div className="pm-grid-cap">
        {t("stage.totalSizes", { count: images.length })}
        <Button variant="ghost" size="sm" onPress={props.onDownloadAll}>
          {t("stage.downloadAll")}
        </Button>
        <Button variant="ghost" size="sm" onPress={props.onReuse}>
          {t("stage.reuseAndRegenerate")}
        </Button>
      </div>
    </div>
  );
}

export function StageToolbar(props: {
  onZoom: () => void;
  onDownload: () => void;
  onReuse: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="pm-stage-toolbar">
      <button type="button" onClick={props.onZoom}>
        <Maximize2 size={13} />
        {t("stage.zoom")}
      </button>
      <button type="button" onClick={props.onDownload}>
        <Download size={13} />
        {t("stage.download")}
      </button>
      <button type="button" onClick={props.onReuse}>
        <RotateCcw size={13} />
        {t("stage.reuse")}
      </button>
      {props.onEdit && (
        <button type="button" onClick={props.onEdit}>
          <RefreshCw size={13} />
          {t("stage.edit")}
        </button>
      )}
      <button type="button" className="danger" onClick={props.onDelete}>
        <Trash2 size={13} />
        {t("stage.delete")}
      </button>
    </div>
  );
}

/** 舞台总装：按 phase / display 选择形态（多张常驻网格，点选弹轮播浮层，见 App） */
export function Stage(props: {
  phase: "idle" | "generating";
  partial: { url: string; index: number } | null;
  genPlan?: GenPlan | null;
  /** 多尺寸生成中每个请求一格；单尺寸为 null */
  slots?: DisplaySlot[] | null;
  /** 视口尺寸：多尺寸排版据此决定一行还是两行 */
  viewport: { w: number; h: number };
  display: DisplayGen | null;
  /** 首页画廊正在展示：空状态引导让位给画廊，两者不叠在一起。
   *  没有画廊时阶段名仍是 "empty"（含列表还在加载的第一帧） */
  hideEmpty?: boolean;
  /** 画廊盖住舞台：舞台不画生成态与结果（生成卡、新作品都在画廊网格里），只留背景与滚轮监听 */
  hidden?: boolean;
  onFocus: (idx: number | null) => void;
  onLightbox: (id: string) => void;
  onDownload: (idx: number) => void;
  onDownloadAll: () => void;
  onReuse: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  const { display, phase, partial, slots } = props;
  const isGen = phase === "generating";
  const done = !isGen && display;
  const single = done && display.images.length === 1;
  // 多尺寸记录（2 张及以上）用等高并列的排版，其余多张仍是 2×2 网格
  const multi = done && !single && !!display.row.params.sizes;
  // 舞台背景取第一格（终稿或预览）的模糊延伸
  const bgUrl = isGen
    ? slots
      ? slots[0]?.url
      : partial?.url
    : done
      ? display.images[0]?.url
      : null;

  return (
    <div
      className={"pm-stage" + (props.hidden ? " is-hidden" : "")}
      data-mode={
        isGen
          ? "gen"
          : done
            ? single
              ? "single"
              : multi
                ? "multi"
                : "grid"
            : props.hideEmpty
              ? // 画廊盖在舞台上：这里没有可见内容
                "home"
              : "empty"
      }
    >
      <div
        className="pm-stage-bg"
        style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
        aria-hidden="true"
      />
      {isGen && slots && (
        <StageMultiGenerating
          slots={slots}
          viewport={props.viewport}
          onCancel={props.onCancel}
        />
      )}
      {isGen && !slots && (
        <StageGenerating
          n={props.genPlan?.n ?? 1}
          size={props.genPlan?.size ?? "auto"}
          partialUrl={partial?.url ?? null}
          partialIndex={partial?.index ?? 0}
          onCancel={props.onCancel}
        />
      )}
      {!isGen && !done && !props.hideEmpty && (
        <StageEmpty onStart={props.onStart} />
      )}
      {single && done && (
        <>
          <div key={display.row.id} className="pm-stage-swap">
            <StageSingle
              display={display}
              img={display.images[0]}
              onZoom={props.onLightbox}
            />
          </div>
          <StageToolbar
            onZoom={() => props.onLightbox(display.images[0].id)}
            onDownload={() => props.onDownload(0)}
            onReuse={props.onReuse}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        </>
      )}
      {!isGen && done && !single && (
        <div key={display.row.id} className="pm-stage-swap">
          {multi ? (
            <StageMulti
              display={display}
              viewport={props.viewport}
              onZoomIn={(i) => props.onFocus(i)}
              onDownload={props.onDownload}
              onDownloadAll={props.onDownloadAll}
              onReuse={props.onReuse}
            />
          ) : (
            <StageGrid
              display={display}
              onZoomIn={(i) => props.onFocus(i)}
              onDownload={props.onDownload}
              onDownloadAll={props.onDownloadAll}
              onReuse={props.onReuse}
            />
          )}
        </div>
      )}
    </div>
  );
}
