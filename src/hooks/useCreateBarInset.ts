import { useEffect, type RefObject } from "react";

/**
 * 把创作条上沿到视口底边的距离写成 --pm-bar-top。
 * 窄屏输入框变高时，舞台工具条据此留在创作条上方，避免被挡住。
 * 监听区间：创作条挂载期间（条尺寸与窗口尺寸）；卸载时去掉变量。
 */
export function useCreateBarInset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => {
      const space = Math.ceil(
        window.innerHeight - el.getBoundingClientRect().top,
      );
      root.style.setProperty("--pm-bar-top", `${space}px`);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    window.addEventListener("resize", write);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      root.style.removeProperty("--pm-bar-top");
    };
  }, [ref]);
}
