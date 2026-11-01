/** GIF 右侧面板：图层列表、图层属性、画布设置。纯展示。 */
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  ImagePlus,
  Images,
  Lock,
  Pencil,
  Sparkles,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import {
  canvasAspectId,
  canvasForAspect,
  GIF_ASPECTS,
} from "../../lib/gif/timeline";
import { GIF_FILTERS } from "../../lib/gif/filters";
import { GIF_TEMPLATES, type GifTemplateId } from "../../lib/gif/templates";
import { fitLayerWindow } from "../../lib/gif/layers";
import type {
  GifCanvas,
  GifLayer,
  GifProject,
  GifTextLayer,
} from "../../lib/gif/types";
import {
  frameDelay,
  GIF_MAX_TEXT,
  GIF_MAX_TEXT_STROKE,
} from "../../lib/gif/types";

export function GifLayersPanel(props: {
  project: GifProject;
  selectedId: string | null;
  urls: Record<string, string>;
  /** 涂鸦模式开关：入口在图层列表的添加入口里 */
  doodleMode: boolean;
  onSelect: (id: string | null) => void;
  onToggleDoodle: () => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onAddGif: () => void;
  onAddSticker: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = (layer: GifLayer, index: number) =>
    layer.name ||
    t(`gif.layers.${layer.kind}Name`, {
      index: index + 1,
    });
  return (
    <section className="pm-gif-panel-section pm-gif-layers">
      <header className="pm-gif-panel-head">
        <h2>{t("gif.layers.title")}</h2>
        <span>{props.project.layers.length}</span>
      </header>
      <div className="pm-gif-addrow">
        <button type="button" onClick={props.onAddText}>
          <Type size={14} />
          {t("gif.layers.addText")}
        </button>
        <button type="button" onClick={props.onAddImage}>
          <ImagePlus size={14} />
          {t("gif.layers.addImage")}
        </button>
        <button type="button" onClick={props.onAddGif}>
          <Images size={14} />
          {t("gif.layers.addGif")}
        </button>
        <button type="button" onClick={props.onAddSticker}>
          <Sparkles size={14} />
          {t("gif.layers.addSticker")}
        </button>
        <button
          type="button"
          aria-pressed={props.doodleMode}
          className={props.doodleMode ? "is-on" : ""}
          onClick={props.onToggleDoodle}
        >
          <Pencil size={14} />
          {t("gif.editor.doodle")}
        </button>
      </div>
      {props.project.layers.length === 0 ? (
        <p className="pm-gif-panel-empty">{t("gif.layers.empty")}</p>
      ) : (
        <ul className="pm-gif-layer-list">
          {props.project.layers
            .map((layer, index) => ({ layer, index }))
            .reverse()
            .map(({ layer, index }) => (
              <li key={layer.id}>
                <button
                  type="button"
                  className={
                    "pm-gif-layer-row" +
                    (layer.id === props.selectedId ? " is-selected" : "") +
                    (layer.visible ? "" : " is-hidden")
                  }
                  onClick={() => props.onSelect(layer.id)}
                >
                  <span className="pm-gif-layer-thumb">
                    {layer.kind === "text" ? (
                      <Type size={15} />
                    ) : layer.kind === "doodle" ? (
                      <Pencil size={15} />
                    ) : props.urls[layer.assetId] ? (
                      <img src={props.urls[layer.assetId]} alt="" />
                    ) : (
                      <span />
                    )}
                  </span>
                  <span className="pm-gif-layer-name">
                    <b>{nameOf(layer, index)}</b>
                    <small>{t(`gif.layers.${layer.kind}`)}</small>
                  </span>
                </button>
                <span className="pm-gif-layer-acts">
                  <button
                    type="button"
                    aria-label={
                      layer.visible
                        ? t("gif.layers.hidden")
                        : t("gif.layers.visible")
                    }
                    onClick={() => props.onToggleVisible(layer.id)}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    type="button"
                    aria-label={
                      layer.locked
                        ? t("gif.layers.unlock")
                        : t("gif.layers.lock")
                    }
                    onClick={() => props.onToggleLock(layer.id)}
                  >
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    type="button"
                    aria-label={t("gif.layers.up")}
                    onClick={() => props.onMove(layer.id, 1)}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("gif.layers.down")}
                    onClick={() => props.onMove(layer.id, -1)}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("gif.layers.duplicate")}
                    onClick={() => props.onDuplicate(layer.id)}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("gif.layers.delete")}
                    onClick={() => props.onDelete(layer.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display?: string;
  onChange: (value: number, record: boolean) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  return (
    <label className="pm-gif-field">
      <span>
        {props.label}
        <b>{props.display ?? props.value.toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.01}
        value={props.value}
        onPointerDown={props.onBegin}
        onChange={(event) => props.onChange(Number(event.target.value), false)}
        onPointerUp={props.onEnd}
        onBlur={props.onEnd}
      />
    </label>
  );
}

/** 秒级数字输入：草稿在本地，失焦或回车才提交 */
function NumberField(props: {
  label: string;
  value: number;
  max: number;
  onCommit: (ms: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (props.value / 1000).toFixed(1);
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw) return;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return;
    props.onCommit(Math.round(seconds * 1000));
  };
  return (
    <label className="pm-gif-num">
      <span>
        {props.label}
        <b>s</b>
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={0.1}
        min={0}
        max={Math.max(0, Math.round(props.max / 1000))}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function GifInspector(props: {
  project: GifProject;
  layer: GifLayer;
  duration: number;
  /** 舞台上双击文字后要聚焦内容输入框的图层 */
  focusText?: { id: string } | null;
  onPatch: (id: string, patch: Partial<GifLayer>, record: boolean) => void;
  onBegin: () => void;
  onEnd: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onApplyChroma: (id: string, color: string, tolerance: number) => void;
  onApplyAiCutout: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { layer } = props;
  const patch = (value: Partial<GifLayer>, record = false) =>
    props.onPatch(layer.id, value, record);
  const frame = frameDelay(props.project.timeline);
  const duration = Math.max(100, props.duration);
  return (
    <section className="pm-gif-panel-section pm-gif-inspector">
      <header className="pm-gif-panel-head">
        <h2>{t("gif.editor.properties")}</h2>
        <div className="pm-gif-inspector-acts">
          <button type="button" onClick={props.onToggleVisible}>
            {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button type="button" onClick={props.onToggleLock}>
            {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button type="button" onClick={props.onDuplicate}>
            <Copy size={14} />
          </button>
          <button type="button" onClick={props.onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <label className="pm-gif-textfield">
        <span>{t("gif.inspector.layerName")}</span>
        <input
          value={layer.name}
          placeholder={t(`gif.layers.${layer.kind}Name`, { index: 1 })}
          onChange={(event) => patch({ name: event.target.value }, true)}
        />
      </label>

      {/* 涂鸦笔迹用画布绝对坐标，没有位置/大小/旋转可言。
          文字的位置和宽度直接在舞台上拖动/缩放，属性里只留旋转 */}
      {layer.kind !== "doodle" && (
        <>
          {layer.kind !== "text" && (
            <>
              <Slider
                label={t("gif.inspector.position") + " X"}
                value={layer.x}
                min={-0.5}
                max={1.5}
                display={`${Math.round(layer.x * 100)}%`}
                onChange={(value, record) => patch({ x: value }, record)}
                onBegin={props.onBegin}
                onEnd={props.onEnd}
              />
              <Slider
                label={t("gif.inspector.position") + " Y"}
                value={layer.y}
                min={-0.5}
                max={1.5}
                display={`${Math.round(layer.y * 100)}%`}
                onChange={(value, record) => patch({ y: value }, record)}
                onBegin={props.onBegin}
                onEnd={props.onEnd}
              />
              <Slider
                label={t("gif.inspector.size")}
                value={layer.width}
                min={0.04}
                max={1.6}
                display={`${Math.round(layer.width * 100)}%`}
                onChange={(value, record) => patch({ width: value }, record)}
                onBegin={props.onBegin}
                onEnd={props.onEnd}
              />
            </>
          )}
          <Slider
            label={t("gif.inspector.rotation")}
            value={layer.rotation}
            min={-180}
            max={180}
            step={1}
            display={`${Math.round(layer.rotation)}°`}
            onChange={(value, record) => patch({ rotation: value }, record)}
            onBegin={props.onBegin}
            onEnd={props.onEnd}
          />
        </>
      )}
      {layer.kind !== "text" && (
        <Slider
          label={t("gif.inspector.opacity")}
          value={layer.opacity}
          min={0}
          max={1}
          display={`${Math.round(layer.opacity * 100)}%`}
          onChange={(value, record) => patch({ opacity: value }, record)}
          onBegin={props.onBegin}
          onEnd={props.onEnd}
        />
      )}

      {layer.kind === "text" && (
        <TextFields
          layer={layer}
          focusText={props.focusText}
          onPatch={(value) => patch(value)}
          onCommit={(value) => patch(value, true)}
          onBegin={props.onBegin}
          onEnd={props.onEnd}
        />
      )}

      {layer.kind !== "text" && (
        <>
          <div className="pm-gif-field-caption">
            {t("gif.inspector.timing")}
          </div>
          <div className="pm-gif-nums">
            <NumberField
              label={t("gif.inspector.start")}
              value={layer.start}
              max={Math.max(0, duration - 100)}
              onCommit={(ms) =>
                patch(
                  fitLayerWindow(
                    { start: ms, end: layer.end },
                    duration,
                    frame,
                  ),
                  true,
                )
              }
            />
            <NumberField
              label={t("gif.inspector.end")}
              value={layer.end}
              max={duration}
              onCommit={(ms) =>
                patch(
                  fitLayerWindow(
                    { start: layer.start, end: ms },
                    duration,
                    frame,
                  ),
                  true,
                )
              }
            />
            <NumberField
              label={t("gif.inspector.length")}
              value={layer.end - layer.start}
              max={Math.max(0, duration - layer.start)}
              onCommit={(ms) =>
                patch(
                  fitLayerWindow(
                    { start: layer.start, end: layer.start + ms },
                    duration,
                    frame,
                  ),
                  true,
                )
              }
            />
          </div>
          <Slider
            label={t("gif.inspector.start")}
            value={layer.start}
            min={0}
            max={Math.max(100, props.duration - 100)}
            step={100}
            display={`${(layer.start / 1000).toFixed(1)}s`}
            onChange={(value, record) => patch({ start: value }, record)}
            onBegin={props.onBegin}
            onEnd={props.onEnd}
          />
          <Slider
            label={t("gif.inspector.end")}
            value={layer.end}
            min={Math.min(100, props.duration)}
            max={Math.max(100, props.duration)}
            step={100}
            display={`${(layer.end / 1000).toFixed(1)}s`}
            onChange={(value, record) => patch({ end: value }, record)}
            onBegin={props.onBegin}
            onEnd={props.onEnd}
          />
        </>
      )}

      {layer.kind === "gif" && (
        <label className="pm-gif-check">
          <input
            type="checkbox"
            checked={layer.loop}
            onChange={(event) => patch({ loop: event.target.checked }, true)}
          />
          <span>{t("gif.gifLayer.loop")}</span>
        </label>
      )}

      {layer.kind === "image" && (
        <ChromaFields
          onApply={(color, tolerance) =>
            props.onApplyChroma(layer.id, color, tolerance)
          }
          onApplyAi={() => props.onApplyAiCutout(layer.id)}
        />
      )}

      {layer.kind === "doodle" && (
        <>
          <div className="pm-gif-field-caption">{t("gif.doodle.title")}</div>
          <label className="pm-gif-color">
            <span>{t("gif.doodle.color")}</span>
            <input
              type="color"
              value={layer.color}
              onChange={(event) => patch({ color: event.target.value }, true)}
            />
          </label>
          <Slider
            label={t("gif.doodle.size")}
            value={layer.size}
            min={0.002}
            max={0.08}
            step={0.001}
            display={`${Math.round(layer.size * 1000)}`}
            onChange={(value, record) => patch({ size: value }, record)}
            onBegin={props.onBegin}
            onEnd={props.onEnd}
          />
          <button
            type="button"
            className="pm-gif-mini"
            onClick={() => patch({ strokes: [] }, true)}
          >
            {t("gif.doodle.clear")}
          </button>
          <p className="pm-gif-hint">{t("gif.doodle.moveHint")}</p>
        </>
      )}
    </section>
  );
}

/** 抠图：取一个颜色与容差，点「应用抠图」把该色系变透明；也可交给 AI 做主体分离 */
function ChromaFields(props: {
  onApply: (color: string, tolerance: number) => void;
  onApplyAi: () => void;
}) {
  const { t } = useTranslation();
  const [color, setColor] = useState("#00b140");
  const [tolerance, setTolerance] = useState(24);
  const [aiBusy, setAiBusy] = useState(false);
  return (
    <>
      <div className="pm-gif-field-caption">{t("gif.chroma.title")}</div>
      <div className="pm-gif-row">
        <label className="pm-gif-color">
          <span>{t("gif.chroma.color")}</span>
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <div className="pm-gif-swatches">
          {["#ffffff", "#000000", "#00b140", "#00b7eb"].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={value}
              className="pm-gif-swatch"
              style={{ background: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
      </div>
      <Slider
        label={t("gif.chroma.tolerance")}
        value={tolerance}
        min={1}
        max={100}
        step={1}
        display={`${tolerance}`}
        onChange={(value) => setTolerance(value)}
        onBegin={() => {}}
        onEnd={() => {}}
      />
      <div className="pm-gif-row">
        <button
          type="button"
          className="pm-gif-mini"
          onClick={() => props.onApply(color, tolerance)}
        >
          {t("gif.chroma.apply")}
        </button>
        <button
          type="button"
          className="pm-gif-mini"
          disabled={aiBusy}
          onClick={() => {
            setAiBusy(true);
            props.onApplyAi();
            window.setTimeout(() => setAiBusy(false), 1500);
          }}
        >
          {aiBusy ? t("gif.chroma.aiBusy") : t("gif.chroma.aiApply")}
        </button>
      </div>
    </>
  );
}

function TextFields(props: {
  layer: GifTextLayer;
  /** 舞台上双击文字后要聚焦内容输入框的图层 */
  focusText?: { id: string } | null;
  onPatch: (value: Partial<GifTextLayer>) => void;
  onCommit: (value: Partial<GifTextLayer>) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const { t } = useTranslation();
  const { layer } = props;
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const editing = useRef(false);
  const patchContinuous = (value: Partial<GifTextLayer>) => {
    // 第一次实际修改前记录快照；输入或拖动期间不再追加撤销步骤。
    if (!editing.current) {
      editing.current = true;
      props.onBegin();
    }
    props.onPatch(value);
  };
  const endEdit = () => {
    if (!editing.current) return;
    editing.current = false;
    props.onEnd();
  };
  useEffect(() => {
    const focus = props.focusText;
    if (!focus || focus.id !== layer.id) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [props.focusText, layer.id]);
  return (
    <div className="pm-gif-textfields">
      <label className="pm-gif-textfield">
        <span>{t("gif.text.content")}</span>
        <textarea
          ref={fieldRef}
          value={layer.text}
          maxLength={GIF_MAX_TEXT}
          placeholder={t("gif.text.placeholder")}
          onChange={(event) => patchContinuous({ text: event.target.value })}
          onBlur={endEdit}
        />
      </label>
      <p className="pm-gif-hint">{t("gif.text.editHint")}</p>
      <label className="pm-gif-field">
        <span>
          {t("gif.text.size")}
          <b>{Math.round(layer.fontSize * 1000) / 10}%</b>
        </span>
        <input
          type="range"
          min={0.02}
          max={0.2}
          step={0.005}
          value={layer.fontSize}
          onChange={(event) =>
            patchContinuous({ fontSize: Number(event.target.value) })
          }
          onPointerUp={endEdit}
          onPointerCancel={endEdit}
          onKeyUp={endEdit}
          onBlur={endEdit}
        />
      </label>
      <div className="pm-gif-row">
        <label className="pm-gif-color">
          <span>{t("gif.text.color")}</span>
          <input
            type="color"
            value={layer.color}
            onChange={(event) => props.onCommit({ color: event.target.value })}
          />
        </label>
        <label className="pm-gif-color">
          <span>{t("gif.text.background")}</span>
          <input
            type="color"
            value={
              layer.backgroundColor === "transparent"
                ? "#000000"
                : layer.backgroundColor
            }
            onChange={(event) =>
              props.onCommit({ backgroundColor: event.target.value })
            }
          />
          <button
            type="button"
            className="pm-gif-mini"
            onClick={() => props.onCommit({ backgroundColor: "transparent" })}
          >
            {t("gif.canvas.transparent")}
          </button>
        </label>
      </div>
      <div className="pm-gif-row">
        <label className="pm-gif-select">
          <span>{t("gif.text.weight")}</span>
          <select
            value={layer.weight}
            onChange={(event) =>
              props.onCommit({
                weight: Number(event.target.value) as 400 | 600 | 700,
              })
            }
          >
            <option value={400}>{t("gif.text.regular")}</option>
            <option value={600}>{t("gif.text.semibold")}</option>
            <option value={700}>{t("gif.text.bold")}</option>
          </select>
        </label>
        <label className="pm-gif-select">
          <span>{t("gif.text.align")}</span>
          <select
            value={layer.align}
            onChange={(event) =>
              props.onCommit({
                align: event.target.value as "left" | "center" | "right",
              })
            }
          >
            <option value="left">{t("gif.text.left")}</option>
            <option value="center">{t("gif.text.center")}</option>
            <option value="right">{t("gif.text.right")}</option>
          </select>
        </label>
      </div>
      <div className="pm-gif-row">
        <label className="pm-gif-color">
          <span>{t("gif.text.strokeColor")}</span>
          <input
            type="color"
            value={layer.strokeColor}
            onChange={(event) =>
              props.onCommit({ strokeColor: event.target.value })
            }
          />
        </label>
        <label className="pm-gif-field compact">
          <span>
            {t("gif.text.strokeWidth")}
            <b>{Math.round(layer.strokeWidth * 1000) / 10}%</b>
          </span>
          <input
            type="range"
            min={0}
            max={GIF_MAX_TEXT_STROKE}
            step={0.002}
            value={layer.strokeWidth}
            onChange={(event) =>
              patchContinuous({ strokeWidth: Number(event.target.value) })
            }
            onPointerUp={endEdit}
            onPointerCancel={endEdit}
            onKeyUp={endEdit}
            onBlur={endEdit}
          />
        </label>
      </div>
      <p className="pm-gif-hint">{t("gif.text.strokeHint")}</p>
    </div>
  );
}

export function GifCanvasPanel(props: {
  project: GifProject;
  onPatch: (patch: Partial<GifCanvas>, record: boolean) => void;
  onTemplate: (id: GifTemplateId) => void;
  onBegin: () => void;
  onEnd: () => void;
}) {
  const { t } = useTranslation();
  const canvas = props.project.canvas;
  const patch = (value: Partial<GifCanvas>, record = false) =>
    props.onPatch(value, record);
  return (
    <section className="pm-gif-panel-section pm-gif-canvas-panel">
      <header className="pm-gif-panel-head">
        <h2>{t("gif.canvas.title")}</h2>
      </header>
      <div className="pm-gif-field-caption">{t("gif.canvas.ratio")}</div>
      <div className="pm-gif-ratios">
        {GIF_ASPECTS.map((item) => {
          const active =
            canvasAspectId(
              canvas,
              props.project.source.width,
              props.project.source.height,
            ) === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                props.onPatch(
                  canvasForAspect(
                    item.id,
                    props.project.source.width,
                    props.project.source.height,
                  ),
                  true,
                )
              }
            >
              {item.id === "source" ? t("gif.canvas.source") : item.id}
            </button>
          );
        })}
      </div>
      <div className="pm-gif-field-caption">{t("gif.canvas.fit")}</div>
      <div className="pm-gif-seg">
        {(["contain", "cover"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={canvas.fit === value}
            onClick={() => patch({ fit: value }, true)}
          >
            {t(`gif.canvas.${value}`)}
          </button>
        ))}
      </div>
      <Slider
        label={t("gif.canvas.zoom")}
        value={canvas.zoom}
        min={0.5}
        max={3}
        display={`${Math.round(canvas.zoom * 100)}%`}
        onChange={(value, record) => patch({ zoom: value }, record)}
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <Slider
        label={t("gif.canvas.offsetX")}
        value={canvas.offsetX}
        min={-0.5}
        max={0.5}
        display={`${Math.round(canvas.offsetX * 100)}%`}
        onChange={(value, record) => patch({ offsetX: value }, record)}
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <Slider
        label={t("gif.canvas.offsetY")}
        value={canvas.offsetY}
        min={-0.5}
        max={0.5}
        display={`${Math.round(canvas.offsetY * 100)}%`}
        onChange={(value, record) => patch({ offsetY: value }, record)}
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <div className="pm-gif-row">
        <button
          type="button"
          className="pm-gif-mini"
          onClick={() => patch({ rotate: 0 }, true)}
        >
          0°
        </button>
        <button
          type="button"
          className="pm-gif-mini"
          onClick={() => patch({ rotate: 90 }, true)}
        >
          90°
        </button>
        <button
          type="button"
          className="pm-gif-mini"
          onClick={() => patch({ rotate: 180 }, true)}
        >
          180°
        </button>
        <button
          type="button"
          className="pm-gif-mini"
          onClick={() => patch({ rotate: 270 }, true)}
        >
          270°
        </button>
        <label className="pm-gif-check">
          <input
            type="checkbox"
            checked={canvas.flipX}
            onChange={(event) => patch({ flipX: event.target.checked }, true)}
          />
          <span>{t("gif.canvas.flipX")}</span>
        </label>
        <label className="pm-gif-check">
          <input
            type="checkbox"
            checked={canvas.flipY}
            onChange={(event) => patch({ flipY: event.target.checked }, true)}
          />
          <span>{t("gif.canvas.flipY")}</span>
        </label>
      </div>
      <div className="pm-gif-field-caption">{t("gif.canvas.background")}</div>
      <div className="pm-gif-seg">
        {(["transparent", "solid", "gradient"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={canvas.background.kind === kind}
            onClick={() => {
              if (kind === "transparent")
                patch({ background: { kind: "transparent" } }, true);
              else if (kind === "solid")
                patch(
                  { background: { kind: "solid", color: "#000000" } },
                  true,
                );
              else
                patch(
                  {
                    background: {
                      kind: "gradient",
                      from: "#FF9A62",
                      to: "#7C5CFF",
                    },
                  },
                  true,
                );
            }}
          >
            {t(`gif.canvas.${kind}`)}
          </button>
        ))}
      </div>
      {canvas.background.kind === "solid" && (
        <label className="pm-gif-color">
          <span>{t("gif.canvas.color")}</span>
          <input
            type="color"
            value={canvas.background.color}
            onChange={(event) =>
              patch(
                { background: { kind: "solid", color: event.target.value } },
                true,
              )
            }
          />
        </label>
      )}
      {canvas.background.kind === "gradient" && (
        <div className="pm-gif-row">
          <label className="pm-gif-color">
            <span>{t("gif.canvas.gradientFrom")}</span>
            <input
              type="color"
              value={canvas.background.from}
              onChange={(event) =>
                patch(
                  {
                    background: {
                      kind: "gradient",
                      from: event.target.value,
                      to:
                        canvas.background.kind === "gradient"
                          ? canvas.background.to
                          : "#000000",
                    },
                  },
                  true,
                )
              }
            />
          </label>
          <label className="pm-gif-color">
            <span>{t("gif.canvas.gradientTo")}</span>
            <input
              type="color"
              value={canvas.background.to}
              onChange={(event) =>
                patch(
                  {
                    background: {
                      kind: "gradient",
                      from:
                        canvas.background.kind === "gradient"
                          ? canvas.background.from
                          : "#000000",
                      to: event.target.value,
                    },
                  },
                  true,
                )
              }
            />
          </label>
        </div>
      )}
      <div className="pm-gif-field-caption">{t("gif.canvas.filter")}</div>
      <div className="pm-gif-seg wide">
        {GIF_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={canvas.filter.preset === item.id}
            onClick={() =>
              patch({ filter: { ...canvas.filter, preset: item.id } }, true)
            }
          >
            {t(`gif.filter.${item.id}`)}
          </button>
        ))}
      </div>
      {canvas.filter.preset !== "none" && (
        <Slider
          label={t("gif.filter.intensity")}
          value={canvas.filter.intensity}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(canvas.filter.intensity * 100)}%`}
          onChange={(value, record) =>
            patch({ filter: { ...canvas.filter, intensity: value } }, record)
          }
          onBegin={props.onBegin}
          onEnd={props.onEnd}
        />
      )}
      <Slider
        label={t("gif.filter.brightness")}
        value={canvas.filter.brightness}
        min={-0.5}
        max={0.5}
        step={0.01}
        display={`${Math.round(canvas.filter.brightness * 100)}`}
        onChange={(value, record) =>
          patch({ filter: { ...canvas.filter, brightness: value } }, record)
        }
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <Slider
        label={t("gif.filter.contrast")}
        value={canvas.filter.contrast}
        min={-0.5}
        max={0.5}
        step={0.01}
        display={`${Math.round(canvas.filter.contrast * 100)}`}
        onChange={(value, record) =>
          patch({ filter: { ...canvas.filter, contrast: value } }, record)
        }
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <Slider
        label={t("gif.filter.saturation")}
        value={canvas.filter.saturation}
        min={-1}
        max={1}
        step={0.02}
        display={`${Math.round(canvas.filter.saturation * 100)}`}
        onChange={(value, record) =>
          patch({ filter: { ...canvas.filter, saturation: value } }, record)
        }
        onBegin={props.onBegin}
        onEnd={props.onEnd}
      />
      <div className="pm-gif-field-caption">{t("gif.template.title")}</div>
      <div className="pm-gif-chips">
        {GIF_TEMPLATES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onTemplate(item.id)}
          >
            {t(`gif.template.${item.id}`)}
          </button>
        ))}
      </div>
    </section>
  );
}
