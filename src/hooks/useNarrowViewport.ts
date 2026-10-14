import { useSyncExternalStore } from "react";

/** 与舞台工具条、详情浮卡的窄屏样式同一断点 */
export const NARROW_VIEWPORT_QUERY = "(max-width: 760px)";

const subscribe = (notify: () => void) => {
  const mq = window.matchMedia(NARROW_VIEWPORT_QUERY);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
};

/**
 * 手机宽度。详情浮卡在窄屏默认收起，避免盖住结果和舞台工具条。
 * 无 SSR：服务端快照按宽屏，避免测试环境误判成窄屏。
 */
export function useNarrowViewport() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches,
    () => false,
  );
}
