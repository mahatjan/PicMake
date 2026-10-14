/** 会话与资源 id
 *
 *  `crypto.randomUUID` 按规范只在安全上下文（HTTPS 或 localhost）可用，局域网 IP 上的
 *  http 页面里它是 undefined，生成流程会在建记录 id 时抛 TypeError。`getRandomValues`
 *  没有这个限制，退回它；再退到 Math.random，保证任何环境都能拿到 v4 形状的 id。
 */

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.getRandomValues === "function")
    webcrypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuid(): string {
  const webcrypto = globalThis.crypto;
  if (typeof webcrypto?.randomUUID === "function")
    return webcrypto.randomUUID();
  return fallbackUuid();
}
