/** 历史抽屉：纯展示的受控弹层 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerDialog,
} from "@heroui/react";
import { Search, Settings2, Star, X } from "lucide-react";
import { fmtTime } from "../../i18n/format";
import type { HistoryRow } from "../../db/schema";
import {
  DEFAULT_HISTORY_FILTER,
  filterHistoryRows,
  isHistoryFilterActive,
  type HistoryFilter,
  type HistoryRange,
} from "../../lib/history-filter";
import { Segmented } from "../controls";

/* ── 历史抽屉：筛选为内部视角，关闭时丢弃；星标经 onToggleStar 写库 ── */
export function HistoryDrawer(props: {
  open: boolean;
  rows: HistoryRow[];
  thumbnailUrls: Record<string, string>;
  currentId: string | null;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>(DEFAULT_HISTORY_FILTER);
  const close = () => {
    props.onClose();
    setFilter(DEFAULT_HISTORY_FILTER);
  };
  const list = filterHistoryRows(props.rows, filter);
  return (
    <Drawer
      isOpen={props.open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DrawerBackdrop isKeyboardDismissDisabled>
        <DrawerContent placement="left">
          <DrawerDialog
            aria-label={t("history.dialog")}
            className="pm-drawer-hd"
          >
            <div className="pm-drawer-h">
              {t("history.title")}
              <Button
                variant="ghost"
                isIconOnly
                size="sm"
                aria-label={t("common.close")}
                onPress={close}
              >
                <X size={14} />
              </Button>
            </div>
            <div className="pm-dfilter">
              <div className="pm-dsearch">
                <Search size={13} aria-hidden="true" />
                <input
                  type="text"
                  value={filter.query}
                  placeholder={t("history.searchPlaceholder")}
                  aria-label={t("history.searchLabel")}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) =>
                    setFilter({ ...filter, query: e.target.value })
                  }
                />
                {filter.query !== "" && (
                  <button
                    type="button"
                    className="pm-dclear"
                    aria-label={t("history.clearSearch")}
                    onClick={() => setFilter({ ...filter, query: "" })}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
              {/* 时间档与「只看收藏」同一行：收藏收成星标图标按钮，名称见 aria-label / title */}
              <div className="pm-drange">
                <Segmented<HistoryRange>
                  full
                  mini
                  ariaLabel={t("history.rangeLabel")}
                  options={[
                    { value: "all", label: t("history.range.all") },
                    { value: "today", label: t("history.range.today") },
                    { value: "7d", label: t("history.range.7d") },
                    { value: "30d", label: t("history.range.30d") },
                  ]}
                  value={filter.range}
                  onChange={(range) => setFilter({ ...filter, range })}
                />
                <button
                  type="button"
                  className={"pm-dfav" + (filter.starredOnly ? " on" : "")}
                  aria-pressed={filter.starredOnly}
                  aria-label={t("history.starredOnly")}
                  title={t("history.starredOnly")}
                  onClick={() =>
                    setFilter({ ...filter, starredOnly: !filter.starredOnly })
                  }
                >
                  <Star
                    size={13}
                    aria-hidden="true"
                    fill={filter.starredOnly ? "currentColor" : "none"}
                  />
                </button>
              </div>
            </div>
            {isHistoryFilterActive(filter) && list.length > 0 && (
              <div className="pm-dcount">
                <span>
                  {t("history.resultCount", {
                    count: list.length,
                    total: props.rows.length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setFilter(DEFAULT_HISTORY_FILTER)}
                >
                  {t("history.clearFilter")}
                </button>
              </div>
            )}
            <div className="pm-dlist">
              {list.map((r) => (
                <div key={r.id} className="pm-drow">
                  <button
                    type="button"
                    className="pm-ditem"
                    aria-current={r.id === props.currentId}
                    onClick={() => props.onSelect(r.id)}
                  >
                    <div
                      className="pm-dthumb"
                      aria-hidden="true"
                      style={
                        props.thumbnailUrls[r.imageIds[0]]
                          ? {
                              backgroundImage: `url(${props.thumbnailUrls[r.imageIds[0]]})`,
                            }
                          : undefined
                      }
                    />
                    <span className="pm-dtxt">
                      <span className="p">{r.prompt}</span>
                      <span className="s">
                        {t("history.rowMeta", {
                          time: fmtTime(r.createdAt, i18n),
                          images: t("count.images", {
                            count: r.imageIds.length,
                          }),
                        })}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={"pm-dstar" + (r.starred ? " on" : "")}
                    aria-pressed={!!r.starred}
                    aria-label={
                      r.starred ? t("history.unstar") : t("history.star")
                    }
                    onClick={() => props.onToggleStar(r.id)}
                  >
                    <Star
                      size={13}
                      aria-hidden="true"
                      fill={r.starred ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              ))}
              {props.rows.length === 0 ? (
                <p className="pm-dempty">{t("history.empty")}</p>
              ) : (
                list.length === 0 && (
                  <div className="pm-dnone">
                    <p className="pm-dempty">
                      {t("history.noMatchTitle")}
                      <br />
                      {t("history.noMatchHint")}
                    </p>
                    <button
                      type="button"
                      className="pm-dnone-reset"
                      onClick={() => setFilter(DEFAULT_HISTORY_FILTER)}
                    >
                      {t("history.clearFilter")}
                    </button>
                  </div>
                )
              )}
            </div>
            <div className="pm-drawer-f">
              <Settings2 size={11} /> {t("history.footer")}
            </div>
          </DrawerDialog>
        </DrawerContent>
      </DrawerBackdrop>
    </Drawer>
  );
}
