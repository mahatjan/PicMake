/** base64 → Blob */
import { imageFormat } from "./input-images";

export function b64ToBlob(b64: string, mime = "image/png"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 从 b64 头部嗅探真实图片格式（16 个 base64 字符 = 12 字节）；失败返回 null */
export function b64Format(b64: string): string | null {
  const head = atob(b64.slice(0, 16));
  return imageFormat(Uint8Array.from(head, (ch) => ch.charCodeAt(0)));
}

/** Blob → data URI。分块拼接，避免一次展开大数组撑爆调用栈 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = "";
    for (let j = 0; j < slice.length; j++)
      part += String.fromCharCode(slice[j]);
    binary += part;
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
