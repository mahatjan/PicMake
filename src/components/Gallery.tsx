/** 首页作品画廊：按时间倒序的记录网格，纯展示；每个并行任务各有一张生成卡，
 *  多尺寸在卡内列出各比例的进度与失败原因；点一项即打开该记录的详情页 */
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { DotsWave } from "./DotsWave";
import type { HistoryRow } from "../db/schema";
import { errorTitle } from "../i18n/errors";
import { fmtTime } from "../i18n/format";
import { sizeCaption } from "../i18n/labels";
import type { ApiErrorKind, PixelSize } from "../lib/types";
/** 生成卡里一个比例的进度（从 store 的 RunSlot 投影，卡内只显示状态与失败原因） */
export interface GenSlotInfo {
  size: PixelSize;
  status: "running" | "done" | "failed";
  failure: ApiErrorKind | null;
}

export interface GalleryTask {
  id: string;
  prompt: string;
  slots: GenSlotInfo[] | null;
  partialUrl: string | null;
  saving: boolean;
  /** 失败原因；null 表示没失败。失败的任务卡留在列表里，用户可以重试或移除 */
  failure: ApiErrorKind | null;
}

/** 生成卡里的一个比例：完成 / 失败 / 进行中 */
function SlotRow(props: { slot: GenSlotInfo }) {
  const { t } = useTranslation();
  return (
    <span className={"pm-gal-slot " + props.slot.status}>
      <span className="pm-gal-slotcap">{sizeCaption(props.slot.size)}</span>
      {props.slot.status === "failed" && (
        <span className="pm-gal-slotmsg">
          {t("stage.failed")} · {errorTitle(props.slot.failure ?? "unknown", t)}
        </span>
      )}
    </span>
  );
}

export function Gallery(props: {
  /** 已按创建时间倒序的记录 */
  rows: HistoryRow[];
  /** 某张图的 URL（内存里刚保存的结果优先，其次列表里的首图缩略图）；取不到时只留占位底色 */
  urlOf: (imageId: string) => string | undefined;
  tasks: GalleryTask[];
  onCancel: (id: string) => void;
  /** 重试失败的任务：用同一份请求重新发一次 */
  onRetry: (id: string) => void;
  /** 移除失败的任务卡 */
  onDismiss: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <section className="pm-gal" aria-label={t("gallery.label")}>
      <div className="pm-gal-h">
        <b>{t("gallery.title")}</b>
        <span>
          {t("gallery.count", {
            count: props.rows.length + props.tasks.length,
          })}
        </span>
      </div>
      <ul className="pm-gal-grid">
        {props.tasks.map((task) => (
          <li key={task.id}>
            <div
              className={
                "pm-gal-card is-gen" + (task.failure ? " is-failed" : "")
              }
              role="status"
              aria-label={
                task.failure
                  ? t("gallery.failedCard")
                  : t("gallery.generatingCard")
              }
            >
              {task.slots ? (
                <span className="pm-gal-slots">
                  {task.slots.map((slot, index) => (
                    <SlotRow key={index} slot={slot} />
                  ))}
                </span>
              ) : task.failure ? (
                <div className="pm-gal-thumb">
                  <span className="pm-gal-fail">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <span>{errorTitle(task.failure, t)}</span>
                  </span>
                </div>
              ) : (
                <div className="pm-gal-thumb">
                  <div
                    className={
                      "pm-dots-wave" + (task.partialUrl ? " is-hidden" : "")
                    }
                    aria-hidden="true"
                  >
                    <DotsWave />
                  </div>
                  {task.partialUrl && (
                    <img
                      src={task.partialUrl}
                      alt=""
                      className="pm-gal-genimg"
                      decoding="async"
                    />
                  )}
                </div>
              )}
              <span className="pm-gal-txt">
                <span className="pm-gal-p" title={task.prompt}>
                  {task.prompt}
                </span>
                <span className="pm-gal-taskrow">
                  <span className="pm-gal-meta">
                    {task.failure
                      ? t("gallery.failed")
                      : task.saving
                        ? t("gallery.saving")
                        : task.slots
                          ? t("bar.genProgress", {
                              done: task.slots.filter(
                                (slot) => slot.status === "done",
                              ).length,
                              total: task.slots.length,
                            })
                          : t("gallery.generatingCard")}
                  </span>
                  {task.failure ? (
                    <span className="pm-gal-acts">
                      <button
                        type="button"
                        className="pm-gal-retry"
                        aria-label={t("gallery.retryTask", {
                          prompt: task.prompt,
                        })}
                        onClick={() => props.onRetry(task.id)}
                      >
                        {t("gallery.retry")}
                      </button>
                      <button
                        type="button"
                        className="pm-gal-dismiss"
                        aria-label={t("gallery.dismissTask", {
                          prompt: task.prompt,
                        })}
                        onClick={() => props.onDismiss(task.id)}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    !task.saving && (
                      <button
                        type="button"
                        className="pm-bar-cancel"
                        aria-label={t("gallery.cancelTask", {
                          prompt: task.prompt,
                        })}
                        onClick={() => props.onCancel(task.id)}
                      >
                        {t("bar.genCancel")}
                      </button>
                    )
                  )}
                </span>
              </span>
            </div>
          </li>
        ))}
        {props.rows.map((row) => {
          const url = props.urlOf(row.imageIds[0]);
          const meta = `${fmtTime(row.createdAt, i18n)} · ${t("count.images", {
            count: row.imageIds.length,
          })}`;
          return (
            <li key={row.id}>
              <button
                type="button"
                className="pm-gal-card"
                onClick={() => props.onOpen(row.id)}
              >
                {url ? (
                  <img
                    src={url}
                    alt={row.prompt}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="pm-gal-ph" aria-hidden="true" />
                )}
                <span className="pm-gal-txt">
                  <span className="pm-gal-p" title={row.prompt}>
                    {row.prompt}
                  </span>
                  <span className="pm-gal-meta">{meta}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
