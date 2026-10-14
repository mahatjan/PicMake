import { afterEach, describe, expect, it } from "vitest";
import { uuid } from "./uuid";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const real = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: real,
    configurable: true,
  });
});

/** 模拟非安全上下文：randomUUID 不存在，getRandomValues 仍在 */
function mockCrypto(partial: unknown) {
  Object.defineProperty(globalThis, "crypto", {
    value: partial,
    configurable: true,
  });
}

describe("uuid", () => {
  it("有 randomUUID 时直接用", () => {
    mockCrypto({ randomUUID: () => "from-native" });
    expect(uuid()).toBe("from-native");
  });

  it("缺 randomUUID（非安全上下文）时退回 getRandomValues，仍是合法 v4", () => {
    mockCrypto({ getRandomValues: (a: Uint8Array) => a.fill(7) });
    const id = uuid();
    expect(id).toMatch(UUID_V4);
  });

  it("连 crypto 都没有时退回 Math.random，形状不变", () => {
    mockCrypto(undefined);
    expect(uuid()).toMatch(UUID_V4);
  });

  it("连续生成不重复", () => {
    let n = 0;
    mockCrypto({
      getRandomValues: (a: Uint8Array) => {
        a.fill(n++ % 256);
        return a;
      },
    });
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    expect(ids.size).toBe(200);
  });
});
