/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK } from "./helpers.ts";

async function openBoard(page: Page, english: boolean) {
  await page.goto("/");
  const settings = page.getByRole("dialog", {
    name: english ? "Settings" : "设置",
  });
  await settings.getByLabel(english ? "API URL" : "API 地址").fill(MOCK);
  await settings.getByLabel("API Key", { exact: true }).fill("mock-key");
  await settings
    .getByRole("button", { name: english ? "Save" : "保存", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: english ? "Expand and generate" : "展开并生成",
    })
    .click();
  await page
    .getByRole("button", {
      name: english ? "Add input" : "添加输入",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: english ? /Draw a sketch/ : /画草图/ })
    .click();
  const board = page.getByRole("dialog", {
    name: english ? "Sketch board" : "草图画板",
  });
  await board.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await board
    .getByRole("button", { name: english ? "Text" : "文字", exact: true })
    .click();
  return board;
}

/** 扫描真实渲染像素，避免仅验证命令存在却未画出文字。 */
async function ink(canvas: Locator) {
  return canvas.evaluate((element) => {
    const cv = element as HTMLCanvasElement;
    const data = cv
      .getContext("2d")!
      .getImageData(0, 0, cv.width, cv.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });
}

/** 透明画布与白底导出图均按真实墨迹计算逻辑边界。 */
async function inkBounds(target: Locator) {
  return target.evaluate(async (element) => {
    let canvas: HTMLCanvasElement;
    if (element instanceof HTMLImageElement) {
      await element.decode();
      canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      canvas.getContext("2d")!.drawImage(element, 0, 0);
    } else canvas = element as HTMLCanvasElement;
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i + 3] < 128 || data[i] > 150) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    return {
      x: left / canvas.width,
      y: top / canvas.height,
      width: (right - left) / canvas.width,
      height: (bottom - top) / canvas.height,
    };
  });
}

/** 文字像素换算到页面坐标，确保浮层与预览之间留有可见间隔。 */
async function editorClearsPreview(board: Locator) {
  const canvas = board.locator("canvas");
  const bounds = await inkBounds(canvas);
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  const paper = (await canvas.boundingBox())!;
  const editor = (await board.locator(".pm-sk-text-editor").boundingBox())!;
  const textTop = paper.y + bounds.y * paper.height;
  const textBottom = textTop + bounds.height * paper.height;
  return editor.y + editor.height <= textTop - 8 || editor.y >= textBottom + 8;
}

for (const english of [false, true]) {
  test.describe(english ? "英文文字工具" : "中文文字工具", () => {
    test.use({ locale: english ? "en-US" : "zh-CN" });

    test("输入面板避开文字预览，上边缘自动翻转，按钮悬停", async ({
      page,
    }, testInfo) => {
      const board = await openBoard(page, english);
      const canvas = board.locator("canvas");
      const paper = (await canvas.boundingBox())!;
      const input = board.getByRole("textbox", {
        name: english ? "Text content" : "文字内容",
      });
      const size = board.getByRole("slider", {
        name: english ? "Font size" : "字号",
      });
      for (const [name, y] of [
        ["middle", 0.5],
        ["top", 0.03],
        ["bottom", 0.98],
      ] as const) {
        await canvas.click({
          position: { x: paper.width * 0.35, y: paper.height * y },
        });
        await input.fill("222222");
        for (const key of ["Home", "End"]) {
          await size.press(key);
          await expect.poll(() => editorClearsPreview(board)).toBe(true);
        }
        await board
          .getByRole("button", {
            name: english ? "Add text to sketch" : "确认文字",
            exact: true,
          })
          .hover();
        await board.screenshot({
          path: testInfo.outputPath(`text-editor-${name}.png`),
        });
        await input.press("Escape");
      }
    });

    test("实时预览、颜色字号、撤销重做、PNG 导出与重新编辑", async ({
      page,
    }, testInfo) => {
      const board = await openBoard(page, english);
      const canvas = board.locator("canvas");
      const input = board.getByRole("textbox", {
        name: english ? "Text content" : "文字内容",
      });
      const undo = board.getByRole("button", {
        name: english ? "Undo" : "撤销",
        exact: true,
      });
      const use = board.getByRole("button", {
        name: english ? "Use sketch" : "使用草图",
        exact: true,
      });
      await canvas.click({ position: { x: 80, y: 170 } });
      await expect(input).toBeFocused();
      await input.fill(english ? "Sketch text" : "测试文字");
      await expect.poll(() => ink(canvas)).toBeGreaterThan(0);
      await expect(undo).toBeDisabled();
      await expect(use).toBeDisabled();
      const smallInk = await ink(canvas);
      const size = board.getByRole("slider", {
        name: english ? "Font size" : "字号",
      });
      await size.focus();
      await size.press("End");
      await expect.poll(() => ink(canvas)).toBeGreaterThan(smallInk);
      await board
        .getByRole("button", {
          name: english ? "Color · Red" : "颜色 · 红色",
          exact: true,
        })
        .click();
      await expect(
        board.getByRole("button", {
          name: english ? "Text" : "文字",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(() =>
          canvas.evaluate((element) => {
            const cv = element as HTMLCanvasElement;
            const d = cv
              .getContext("2d")!
              .getImageData(0, 0, cv.width, cv.height).data;
            for (let i = 0; i < d.length; i += 4)
              if (
                d[i + 3] === 255 &&
                d[i] === 229 &&
                d[i + 1] === 57 &&
                d[i + 2] === 53
              )
                return true;
            return false;
          }),
        )
        .toBe(true);
      await input.press("Enter");
      await expect(input).toBeHidden();
      const committed = await canvas.evaluate((el) =>
        (el as HTMLCanvasElement).toDataURL(),
      );
      await undo.click();
      await expect.poll(() => ink(canvas)).toBe(0);
      await board
        .getByRole("button", { name: english ? "Redo" : "重做", exact: true })
        .click();
      await expect
        .poll(() =>
          canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
        )
        .toBe(committed);
      await board.screenshot({ path: testInfo.outputPath("text-board.png") });
      await use.click();
      await expect(board).toBeHidden();
      const image = page.locator(".pm-bar-thumb img").first();
      await expect(image).toBeVisible();
      const exported = await image.evaluate(async (element) => {
        const img = element as HTMLImageElement;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let red = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] === 229 && data[i + 1] === 57 && data[i + 2] === 53)
            red++;
        return { red, width: cv.width, height: cv.height };
      });
      expect(exported.red).toBeGreaterThan(0);
      expect(exported.width).toBe(1536);
      expect(exported.height).toBe(1024);
      await page.locator(".pm-bar-thumb button.sk").click();
      await expect(board).toBeVisible();
      await expect.poll(() => ink(canvas)).toBeGreaterThan(0);
      await board
        .getByRole("button", { name: english ? "Clear" : "清空", exact: true })
        .click();
      await expect.poll(() => ink(canvas)).toBe(0);
      await undo.click();
      await expect.poll(() => ink(canvas)).toBeGreaterThan(0);
    });

    test("空白、超限、输入法、连续定位与键盘取消", async ({ page }) => {
      const board = await openBoard(page, english);
      const canvas = board.locator("canvas");
      const input = board.getByRole("textbox", {
        name: english ? "Text content" : "文字内容",
      });
      const confirm = board.getByRole("button", {
        name: english ? "Add text to sketch" : "确认文字",
        exact: true,
      });
      const undo = board.getByRole("button", {
        name: english ? "Undo" : "撤销",
        exact: true,
      });
      await canvas.focus();
      await canvas.press("Enter");
      await expect(input).toBeFocused();
      await input.fill("   ");
      await expect(confirm).toBeDisabled();
      await input.press("Enter");
      await expect(input).toBeHidden();
      await expect(undo).toBeDisabled();
      await canvas.press("Enter");
      await input.fill("x".repeat(201));
      await expect(confirm).toBeDisabled();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await input.press("Enter");
      await expect(input).toBeVisible();
      await input.fill("x".repeat(200));
      await expect(confirm).toBeEnabled();
      await input.fill(english ? "First" : "第一段");
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
      await expect(input).toBeVisible();
      await expect(undo).toBeDisabled();
      await canvas.click({ position: { x: 70, y: 250 } });
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(undo).toBeEnabled();
      const committedInk = await ink(canvas);
      await input.fill(english ? "Cancel this" : "取消这段");
      await input.press("Escape");
      await expect(input).toBeHidden();
      await expect.poll(() => ink(canvas)).toBe(committedInk);
      await undo.click();
      await expect.poll(() => ink(canvas)).toBe(0);
    });

    test("文字拖动、角点缩放、取消与一步撤销，导出后继续调整", async ({
      page,
    }, testInfo) => {
      const board = await openBoard(page, english);
      const canvas = board.locator("canvas");
      await canvas.click({ position: { x: 110, y: 190 } });
      const input = board.getByRole("textbox", {
        name: english ? "Text content" : "文字内容",
      });
      await input.fill("Move text");
      await input.press("Enter");
      const text = board.getByRole("button", {
        name: english ? "Select text: Move text" : "选择文字：Move text",
        exact: true,
      });
      const undo = board.getByRole("button", {
        name: english ? "Undo" : "撤销",
        exact: true,
      });
      const redo = board.getByRole("button", {
        name: english ? "Redo" : "重做",
        exact: true,
      });
      await expect(text).toHaveAttribute("aria-pressed", "true");
      const original = await inkBounds(canvas);
      const start = (await text.boundingBox())!;
      const drag = async (target: Locator, dx: number, dy: number) => {
        const box = (await target.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + dx,
          box.y + box.height / 2 + dy,
          { steps: 5 },
        );
      };
      await drag(text, 85, 60);
      await expect
        .poll(async () => (await inkBounds(canvas)).x)
        .toBeGreaterThan(original.x);
      await page.mouse.up();
      const moved = await inkBounds(canvas);
      expect(moved.y).toBeGreaterThan(original.y);
      await undo.click();
      expect(await inkBounds(canvas)).toEqual(original);
      await redo.click();
      expect(await inkBounds(canvas)).toEqual(moved);
      // 点击选择不产生新命令，缩放一步撤销后仍是移动后的状态。
      await text.click();
      const handle = board.getByRole("button", {
        name: english ? "Drag to resize text" : "拖动缩放文字",
        exact: true,
      });
      await drag(handle, 65, -20);
      await page.mouse.up();
      const scaled = await inkBounds(canvas);
      expect(scaled.width).toBeGreaterThan(moved.width * 1.3);
      await undo.click();
      expect(await inkBounds(canvas)).toEqual(moved);
      await redo.click();
      expect(await inkBounds(canvas)).toEqual(scaled);
      await drag(text, 25, 20);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(await inkBounds(canvas)).toEqual(scaled);
      await text.focus();
      await text.press("Shift+ArrowRight");
      expect((await inkBounds(canvas)).x).toBeGreaterThan(scaled.x);
      await undo.click();
      expect(await inkBounds(canvas)).toEqual(scaled);
      await text.focus();
      const larger = board.getByRole("button", {
        name: english ? "Make text larger" : "放大文字",
        exact: true,
      });
      await larger.click();
      expect((await inkBounds(canvas)).width).toBeGreaterThan(scaled.width);
      await board
        .getByRole("button", {
          name: english ? "Make text smaller" : "缩小文字",
          exact: true,
        })
        .click();
      const final = await inkBounds(canvas);
      await board.screenshot({
        path: testInfo.outputPath("text-transform.png"),
      });
      const done = board.getByRole("button", {
        name: english ? "Finish transforming text" : "完成调整文字",
        exact: true,
      });
      await done.focus();
      await done.press("Enter");
      await expect(done).toBeHidden();
      await expect(
        board.getByRole("button", {
          name: english ? "Text" : "文字",
          exact: true,
        }),
      ).toBeFocused();
      await board
        .getByRole("button", {
          name: english ? "Use sketch" : "使用草图",
          exact: true,
        })
        .click();
      const exported = await inkBounds(
        page.locator(".pm-bar-thumb img").first(),
      );
      expect(Math.abs(exported.x - final.x)).toBeLessThan(0.01);
      expect(Math.abs(exported.width - final.width)).toBeLessThan(0.01);
      await page.locator(".pm-bar-thumb button.sk").click();
      await board
        .getByRole("button", { name: english ? "Text" : "文字", exact: true })
        .click();
      await expect(text).toBeVisible();
      expect((await text.boundingBox())!.x).toBeGreaterThan(start.x);
      await text.focus();
      await text.press("-");
      expect((await inkBounds(canvas)).width).toBeLessThan(final.width);
      await board
        .getByRole("button", { name: english ? "Clear" : "清空", exact: true })
        .click();
      await expect(text).toBeHidden();
      await undo.click();
      await expect(text).toBeVisible();
    });

    test.describe("移动设备", () => {
      test.use({ isMobile: true, hasTouch: true });

      test("触摸确认文字后能完成调整并再次选择", async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const board = await openBoard(page, english);
        const canvas = board.locator("canvas");
        await canvas.tap({ position: { x: 70, y: 100 } });
        const input = board.getByRole("textbox", {
          name: english ? "Text content" : "文字内容",
        });
        await input.fill("Done");
        await expect.poll(() => editorClearsPreview(board)).toBe(true);
        await page.setViewportSize({ width: 390, height: 500 });
        await expect(input).toBeFocused();
        await expect.poll(() => editorClearsPreview(board)).toBe(true);
        await page.setViewportSize({ width: 390, height: 844 });
        await board.screenshot({
          path: testInfo.outputPath("text-editor-touch.png"),
        });
        await board
          .getByRole("button", {
            name: english ? "Add text to sketch" : "确认文字",
            exact: true,
          })
          .tap();
        const options = board.locator(".pm-sk-text-options");
        await expect(options).toBeVisible();
        const before = await inkBounds(canvas);
        await board
          .getByRole("button", {
            name: english ? "Finish transforming text" : "完成调整文字",
            exact: true,
          })
          .tap();
        await expect(options).toBeHidden();
        await expect(
          board.getByRole("button", {
            name: english ? "Text" : "文字",
            exact: true,
          }),
        ).toBeFocused();
        expect(await inkBounds(canvas)).toEqual(before);
        const text = board.locator(".pm-sk-text-target");
        await expect(text).toHaveAttribute("aria-pressed", "false");
        await text.tap();
        await expect(options).toBeVisible();
        await board
          .getByRole("button", {
            name: english ? "Finish transforming text" : "完成调整文字",
            exact: true,
          })
          .tap();
        await expect(options).toBeHidden();
        await expect(text).toHaveAttribute("aria-pressed", "false");
        await expect(
          board.getByRole("button", {
            name: english ? "Text" : "文字",
            exact: true,
          }),
        ).toBeFocused();
      });

      test("单指移动与手柄缩放，双指接管画布且取消未提交的文字调整", async ({
        page,
      }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const board = await openBoard(page, english);
        const canvas = board.locator("canvas");
        await canvas.click({ position: { x: 70, y: 70 } });
        const input = board.getByRole("textbox", {
          name: english ? "Text content" : "文字内容",
        });
        await input.fill("Touch");
        await input.press("Enter");
        const text = board.getByRole("button", {
          name: english ? "Select text: Touch" : "选择文字：Touch",
          exact: true,
        });
        const session = await page.context().newCDPSession(page);
        const touch = (
          type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
          touchPoints: { id: number; x: number; y: number }[],
        ) => session.send("Input.dispatchTouchEvent", { type, touchPoints });
        const original = await inkBounds(canvas);
        let box = (await text.boundingBox())!;
        const from = {
          id: 1,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
        await touch("touchStart", [from]);
        await touch("touchMove", [{ ...from, x: from.x + 35, y: from.y + 20 }]);
        await touch("touchEnd", []);
        const moved = await inkBounds(canvas);
        expect(moved.x).toBeGreaterThan(original.x);
        const handle = board.getByRole("button", {
          name: english ? "Drag to resize text" : "拖动缩放文字",
          exact: true,
        });
        box = (await handle.boundingBox())!;
        const corner = { id: 1, x: box.x + 22, y: box.y + 22 };
        await touch("touchStart", [corner]);
        await touch("touchMove", [
          { ...corner, x: corner.x + 30, y: corner.y - 15 },
        ]);
        await touch("touchEnd", []);
        const resized = await inkBounds(canvas);
        expect(resized.width).toBeGreaterThan(moved.width);
        box = (await text.boundingBox())!;
        const a = {
          id: 1,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
        const b = { id: 2, x: a.x + 45, y: a.y + 45 };
        await touch("touchStart", [a]);
        await touch("touchMove", [{ ...a, x: a.x + 10 }]);
        await touch("touchStart", [{ ...a, x: a.x + 10 }, b]);
        await touch("touchMove", [
          { ...a, x: a.x - 20 },
          { ...b, x: b.x + 30 },
        ]);
        await touch("touchEnd", []);
        const fit = board.getByRole("button", {
          name: english ? "Fit to screen" : "适应屏幕",
          exact: true,
        });
        await expect(fit).not.toHaveText("100%");
        await fit.click();
        expect(await inkBounds(canvas)).toEqual(resized);
        await board
          .getByRole("button", { name: english ? "Undo" : "撤销", exact: true })
          .click();
        expect(await inkBounds(canvas)).toEqual(moved);
        expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
        await session.detach();
      });

      test("窄屏触摸定位、画布边缘与深浅主题", async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 844 });
        const board = await openBoard(page, english);
        const canvas = board.locator("canvas");
        const input = board.getByRole("textbox", {
          name: english ? "Text content" : "文字内容",
        });
        const session = await page.context().newCDPSession(page);
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (value) =>
              document.documentElement.classList.toggle(
                "dark",
                value === "dark",
              ),
            theme,
          );
          const box = (await canvas.boundingBox())!;
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: box.x + box.width - 2, y: box.y + 2 }],
          });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await expect(input).toBeFocused();
          // iOS 聚焦小于 16px 的输入框会自动放大整个页面；覆盖默认、最小与最大字号。
          const size = board.getByRole("slider", {
            name: english ? "Font size" : "字号",
          });
          for (const key of [null, "Home", "End"]) {
            if (key) await size.press(key);
            await input.focus();
            expect(
              await input.evaluate((el) =>
                Number.parseFloat(getComputedStyle(el).fontSize),
              ),
            ).toBeGreaterThanOrEqual(16);
            expect(
              await page.evaluate(() => window.visualViewport?.scale),
            ).toBe(1);
          }
          await input.fill("Edge");
          // 模拟软键盘引起的可用高度变化，重排不应丢掉行内草稿。
          await page.setViewportSize({ width: 320, height: 700 });
          await expect(input).toHaveValue("Edge");
          await expect(input).toBeFocused();
          await page.setViewportSize({ width: 320, height: 844 });
          const editor = board.getByRole("group", {
            name: english ? "Add text" : "添加文字",
            exact: true,
          });
          const bounds = (await editor.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
          if (english) {
            const ui = await editor.evaluate(
              (el) =>
                el.textContent +
                Array.from(el.querySelectorAll("[aria-label],[placeholder]"))
                  .map(
                    (e) =>
                      (e.getAttribute("aria-label") ?? "") +
                      (e.getAttribute("placeholder") ?? ""),
                  )
                  .join(" "),
            );
            expect(ui).not.toMatch(/[\u3400-\u9fff]/);
          }
          await board.screenshot({
            path: testInfo.outputPath(`text-${theme}-mobile.png`),
          });
          await input.press("Escape");
        }
        await session.detach();
      });
    });
  });
}
