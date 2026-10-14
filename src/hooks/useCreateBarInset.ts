import { useEffect, type RefObject } from "react";

/** 短于这个高度的视口收缩是地址栏，不是键盘 */
const KEYBOARD_COVER_MIN = 120;

export type KeyboardViewport = {
  layoutHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
};

/**
 * 键盘覆盖布局视口的高度。只比较布局视口与 visual viewport：
 * 若浏览器已把布局视口一并压矮，fixed 元素会自动上移，此处必须返回 0，
 * 否则再按聚焦前的高度补偿会把创作条重复上移到屏幕外。
 */
export function keyboardCover(view: KeyboardViewport): number {
  const overlap =
    view.layoutHeight - view.viewportOffsetTop - view.viewportHeight;
  return overlap > KEYBOARD_COVER_MIN ? Math.ceil(overlap) : 0;
}

/**
 * 把创作条上沿到视口底边的距离写成 --pm-bar-top。
 * 键盘盖住视口时把遮挡高度写成 --pm-keyboard，创作条用来抵消底部安全区。
 * 窄屏输入框变高时，舞台工具条据此留在创作条上方，避免被挡住。
 * 监听区间：创作条挂载期间（条尺寸、窗口尺寸、visualViewport 的 resize 与 scroll）；卸载时去掉变量。
 */
export function useCreateBarInset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const writeBar = () => {
      const space = Math.ceil(
        window.innerHeight - el.getBoundingClientRect().top,
      );
      root.style.setProperty("--pm-bar-top", `${space}px`);
    };
    const writeKeyboard = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const inset = keyboardCover({
        layoutHeight: window.innerHeight,
        viewportHeight: vv.height,
        viewportOffsetTop: vv.offsetTop,
      });
      root.style.setProperty("--pm-keyboard", `${inset}px`);
    };
    const write = () => {
      writeKeyboard();
      // --pm-keyboard 会改变条的位置；在同一轮重新测量其上沿。
      writeBar();
    };
    write();
    const observer = new ResizeObserver(writeBar);
    observer.observe(el);
    window.addEventListener("resize", write);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", write);
    vv?.addEventListener("scroll", write);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      vv?.removeEventListener("resize", write);
      vv?.removeEventListener("scroll", write);
      root.style.removeProperty("--pm-bar-top");
      root.style.removeProperty("--pm-keyboard");
    };
  }, [ref]);
}
