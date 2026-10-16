import { useCallback, useEffect, useRef } from "react";

/** 下载用 Blob URL：保留一分钟供浏览器读取；到期或卸载时回收 URL 和定时器。 */
export function useDownloadUrl(): (blob: Blob) => string {
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const urls = pending.current;
    return () => {
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  return useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      pending.current.delete(url);
    }, 60_000);
    pending.current.set(url, timer);
    return url;
  }, []);
}
