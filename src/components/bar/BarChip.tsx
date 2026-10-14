/** 值 chip + 向上弹层原语（BarChip / PopRow） */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export function BarChip(props: {
  ariaLabel: string;
  /** 当前值（印在 chip 上）；icon 型 chip 可不传 */
  value?: ReactNode;
  /** 值后面的固定后缀（如「快速」「质量」） */
  suffix?: string;
  /** 图标形态（与 value 二选一或并用） */
  icon?: ReactNode;
  /** 值 ≠ 默认值时的强调态（橙色描边 + 橙字 + 淡橙底） */
  dirty?: boolean;
  disabled?: boolean;
  /** 悬停提示（如不可用的原因） */
  title?: string;
  /** 弹层右对齐（条尾 chip 用） */
  right?: boolean;
  popWidth?: number;
  /** 单选型弹层：点选项后自动收起（多步弹层如比例/更多不收） */
  closeOnSelect?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className={"pm-chip-wrap" + (props.right ? " right" : "")} ref={ref}>
      <button
        type="button"
        className={
          "pm-chip" +
          (props.dirty ? " dirty" : "") +
          (props.icon ? " icon" : "") +
          (open ? " active" : "")
        }
        aria-label={props.ariaLabel}
        aria-expanded={open}
        title={props.title}
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {props.icon}
        {props.value != null && <b>{props.value}</b>}
        {props.suffix && <span className="pm-chip-suffix">{props.suffix}</span>}
        {!props.icon && (
          <span className="pm-chip-car" aria-hidden>
            ▾
          </span>
        )}
      </button>
      {open && (
        <div
          className="pm-pop"
          style={
            props.popWidth
              ? ({ "--pm-pop-min": `${props.popWidth}px` } as CSSProperties)
              : undefined
          }
          role="dialog"
          aria-label={props.ariaLabel}
          onClick={(e) => {
            if (
              props.closeOnSelect &&
              (e.target as HTMLElement).closest("button")
            )
              setOpen(false);
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}

/** 弹层内的单选行（名称 + 一句话说明 + 选中勾） */
export function PopRow(props: {
  selected: boolean;
  name: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"pm-pop-opt" + (props.selected ? " on" : "")}
      onClick={props.onClick}
    >
      <span>
        <span className="nm">{props.name}</span>
        <span className="ds">{props.desc}</span>
      </span>
      <span className="ck" aria-hidden>
        ✓
      </span>
    </button>
  );
}
