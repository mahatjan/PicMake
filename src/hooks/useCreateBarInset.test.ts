import { describe, expect, it } from "vitest";
import { keyboardCover } from "./useCreateBarInset";

describe("keyboardCover", () => {
  it("布局视口与 visual viewport 相同时无需补偿", () => {
    expect(
      keyboardCover({
        layoutHeight: 844,
        viewportHeight: 844,
        viewportOffsetTop: 0,
      }),
    ).toBe(0);
  });

  it("键盘只覆盖 visual viewport 时返回遮挡高度", () => {
    expect(
      keyboardCover({
        layoutHeight: 844,
        viewportHeight: 430,
        viewportOffsetTop: 0,
      }),
    ).toBe(414);
  });

  it("地址栏造成的小幅收缩不当成键盘", () => {
    expect(
      keyboardCover({
        layoutHeight: 844,
        viewportHeight: 760,
        viewportOffsetTop: 0,
      }),
    ).toBe(0);
  });

  it("浏览器已随键盘压矮布局视口时不重复上移", () => {
    expect(
      keyboardCover({
        layoutHeight: 430,
        viewportHeight: 430,
        viewportOffsetTop: 0,
      }),
    ).toBe(0);
  });

  it("visual viewport 有顶部偏移时按其底边计算遮挡", () => {
    expect(
      keyboardCover({
        layoutHeight: 844,
        viewportHeight: 500,
        viewportOffsetTop: 44,
      }),
    ).toBe(300);
  });
});
