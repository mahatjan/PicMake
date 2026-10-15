/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK } from "./helpers.ts";

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

async function openBoard(page: Page, english = false) {
  await page.goto("/");
  const settings = page.getByRole("dialog", {
    name: english ? "Settings" : "设置",
  });
  await settings.getByLabel(english ? "API URL" : "API 地址").fill(MOCK);
  await settings.getByLabel("API Key", { exact: true }).fill("mock-key");
  await settings
    .getByRole("button", { name: english ? "Save" : "保存", exact: true })
    .click();
  await expect(settings).toBeHidden();
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
  await expect(board).toBeVisible();
  // 等待画板入场缩放结束，再读取尺寸或把坐标用于绘制。
  await board.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  return board;
}

async function selectShape(board: Locator, name: string) {
  const button = board.getByRole("button", { name: "形状", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await board.getByRole("button", { name, exact: true }).click();
}

async function drag(page: Page, box: Box, from: Point, to: Point) {
  await page.mouse.move(
    box.x + from.x * box.width,
    box.y + from.y * box.height,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + to.x * box.width, box.y + to.y * box.height, {
    steps: 5,
  });
  await page.mouse.up();
}

async function pixel(canvas: Locator, x: number, y: number) {
  return canvas.evaluate(
    (element, point) => {
      const cv = element as HTMLCanvasElement;
      return Array.from(
        cv
          .getContext("2d")!
          .getImageData(
            Math.round(point.x * cv.width),
            Math.round(point.y * cv.height),
            1,
            1,
          ).data,
      );
    },
    { x, y },
  );
}

async function expectInk(canvas: Locator, x: number, y: number, ink = true) {
  await expect
    .poll(async () => (await pixel(canvas, x, y))[3])
    .toBe(ink ? 255 : 0);
}

/** 在拖动方向上扫描实际像素：箭头尖端应落在松手点，前方不得残留箭杆。 */
async function arrowExtent(
  target: Locator,
  tip: Point,
  direction: Point,
  size: Box,
) {
  return target.evaluate(
    async (element, args) => {
      let cv: HTMLCanvasElement;
      if (element instanceof HTMLImageElement) {
        await element.decode();
        cv = document.createElement("canvas");
        cv.width = element.naturalWidth;
        cv.height = element.naturalHeight;
        cv.getContext("2d")!.drawImage(element, 0, 0);
      } else cv = element as HTMLCanvasElement;
      const data = cv
        .getContext("2d")!
        .getImageData(0, 0, cv.width, cv.height).data;
      let ink = 0;
      let furthest = -Infinity;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4;
          // 导出图为白底；透明预览与白底 PNG 均只统计可见的深色像素。
          if (
            data[i + 3] <= 16 ||
            Math.min(data[i], data[i + 1], data[i + 2]) >= 200
          )
            continue;
          ink++;
          const dx = ((x + 0.5) * args.size.width) / cv.width - args.tip.x;
          const dy = ((y + 0.5) * args.size.height) / cv.height - args.tip.y;
          furthest = Math.max(
            furthest,
            dx * args.direction.x + dy * args.direction.y,
          );
        }
      }
      return { ink, furthest };
    },
    { tip, direction, size },
  );
}

for (const thickness of ["Home", "End"]) {
  test(`箭头尖端无外露线条：${thickness === "Home" ? "细线" : "粗线"}，八个方向与短箭头的预览和导出`, async ({
    page,
  }, testInfo) => {
    const board = await openBoard(page);
    await selectShape(board, "箭头");
    const slider = board.getByRole("slider", { name: "工具大小", exact: true });
    await slider.focus();
    await slider.press(thickness);
    await expect(slider).toHaveValue(thickness === "Home" ? "0" : "1");
    const canvas = board.locator("canvas");
    const box = (await canvas.boundingBox())!;
    const from = { x: box.width * 0.5, y: box.height * 0.5 };
    let tip = from;
    let direction = { x: 1, y: 0 };
    for (let i = 0; i <= 8; i++) {
      if (i > 0)
        await board.getByRole("button", { name: "清空", exact: true }).click();
      const angle = ((i % 8) * Math.PI) / 4;
      direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const length = i === 8 ? 12 : Math.min(box.width, box.height) * 0.3;
      tip = {
        x: from.x + direction.x * length,
        y: from.y + direction.y * length,
      };
      await page.mouse.move(box.x + from.x, box.y + from.y);
      await page.mouse.down();
      await page.mouse.move(box.x + tip.x, box.y + tip.y, { steps: 4 });
      await expect
        .poll(async () => (await arrowExtent(canvas, tip, direction, box)).ink)
        .toBeGreaterThan(0);
      const preview = await arrowExtent(canvas, tip, direction, box);
      expect(preview.furthest).toBeLessThanOrEqual(1); // 容许边缘抗锯齿与指针坐标取整。
      expect(preview.furthest).toBeGreaterThan(-2);
      await page.mouse.up();
      await expect(
        board.getByRole("button", { name: "使用草图", exact: true }),
      ).toBeEnabled();
      if (i === 1 && thickness === "End") {
        await canvas.screenshot({
          path: testInfo.outputPath("arrow-diagonal.png"),
        });
      }
      expect(
        (await arrowExtent(canvas, tip, direction, box)).furthest,
      ).toBeLessThanOrEqual(1);
    }
    await board.getByRole("button", { name: "使用草图", exact: true }).click();
    await expect(board).toBeHidden();
    const image = page.locator(".pm-bar-thumb img").first();
    await expect(image).toBeVisible();
    const exported = await arrowExtent(image, tip, direction, box);
    expect(exported.ink).toBeGreaterThan(0);
    expect(exported.furthest).toBeLessThanOrEqual(1);
    expect(exported.furthest).toBeGreaterThan(-2);
  });
}

test("四种形状、填充、换色、撤销重做、PNG 导出及附件重开", async ({ page }) => {
  const board = await openBoard(page);
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await selectShape(board, "矩形");
  await board.getByRole("button", { name: "颜色 · 红色", exact: true }).click();
  await expect(
    board.getByRole("button", { name: "形状", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(page, box, { x: 0.12, y: 0.22 }, { x: 0.3, y: 0.42 });
  await expectInk(canvas, 0.12, 0.32);
  await expectInk(canvas, 0.21, 0.32, false);

  await selectShape(board, "椭圆");
  await board.getByRole("button", { name: "实心", exact: true }).click();
  await drag(page, box, { x: 0.42, y: 0.22 }, { x: 0.62, y: 0.42 });
  await expectInk(canvas, 0.52, 0.32);
  await expectInk(canvas, 0.42, 0.22, false);

  await selectShape(board, "直线");
  await expect(
    board.getByRole("button", { name: "实心", exact: true }),
  ).toBeHidden();
  await drag(page, box, { x: 0.15, y: 0.65 }, { x: 0.35, y: 0.65 });
  await expectInk(canvas, 0.25, 0.65);
  await selectShape(board, "箭头");
  await drag(page, box, { x: 0.55, y: 0.65 }, { x: 0.8, y: 0.65 });
  await expectInk(canvas, 0.7, 0.65);
  // 默认线宽下，箭头底部超出杆身；验证单向箭头确有三角头。
  await expectInk(canvas, 0.775, 0.642);
  await board.getByRole("button", { name: "撤销", exact: true }).click();
  await expectInk(canvas, 0.7, 0.65, false);
  await board.getByRole("button", { name: "重做", exact: true }).click();
  await expectInk(canvas, 0.7, 0.65);

  await board.getByRole("button", { name: "使用草图", exact: true }).click();
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
    const sample = (x: number, y: number) =>
      Array.from(
        ctx.getImageData(
          Math.round(x * cv.width),
          Math.round(y * cv.height),
          1,
          1,
        ).data,
      );
    return {
      width: cv.width,
      height: cv.height,
      color: sample(0.52, 0.32),
      empty: sample(0.21, 0.32),
      arrow: sample(0.7, 0.65),
    };
  });
  expect(exported).toEqual({
    width: 1536,
    height: 1024,
    color: [229, 57, 53, 255],
    empty: [255, 255, 255, 255],
    arrow: [229, 57, 53, 255],
  });
  await page.locator(".pm-bar-thumb button.sk").click();
  await expect(board).toBeVisible();
  await expectInk(canvas, 0.52, 0.32);
  await expectInk(canvas, 0.7, 0.65);
  await board.getByRole("button", { name: "橡皮", exact: true }).click();
  const reopened = (await canvas.boundingBox())!;
  await page.mouse.click(
    reopened.x + reopened.width * 0.52,
    reopened.y + reopened.height * 0.32,
  );
  await expectInk(canvas, 0.52, 0.32, false);
  await board.getByRole("button", { name: "撤销", exact: true }).click();
  await expectInk(canvas, 0.52, 0.32);
  await board.getByRole("button", { name: "清空", exact: true }).click();
  await expect(
    board.getByRole("button", { name: "使用草图", exact: true }),
  ).toBeDisabled();
  await board.getByRole("button", { name: "撤销", exact: true }).click();
  await expectInk(canvas, 0.52, 0.32);
});

test("鼠标静止时按下和松开 Shift 立即更新预览，松手保留最终约束", async ({
  page,
}) => {
  const board = await openBoard(page);
  await selectShape(board, "矩形");
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const x = 0.2,
    y = 0.4;
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * x + 80,
    box.y + box.height * y + 30,
  );
  await expectInk(canvas, x + 40 / box.width, y + 30 / box.height);
  await page.keyboard.down("Shift");
  await expectInk(canvas, x + 40 / box.width, y + 80 / box.height);
  await expectInk(canvas, x + 40 / box.width, y + 30 / box.height, false);
  await page.keyboard.up("Shift");
  await expectInk(canvas, x + 40 / box.width, y + 30 / box.height);
  await expectInk(canvas, x + 40 / box.width, y + 80 / box.height, false);
  await page.keyboard.down("Shift");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectInk(canvas, x + 40 / box.width, y + 80 / box.height);
});

test("进入形状模式前按住 Shift，短线仍保持拖动长度", async ({ page }) => {
  const board = await openBoard(page);
  await page.keyboard.down("Shift");
  await selectShape(board, "直线");
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await drag(page, box, { x: 0.2, y: 0.5 }, { x: 0.3, y: 0.51 });
  await page.keyboard.up("Shift");
  await expectInk(canvas, 0.25, 0.5);
  await expectInk(canvas, 0.4, 0.5, false);
});

test("松手事件提供最终坐标与 Shift，未收到最后一次移动也能正确提交", async ({
  page,
}) => {
  const board = await openBoard(page);
  await selectShape(board, "矩形");
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const origin = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.4 };
  const event = {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
  };
  await canvas.dispatchEvent("pointerdown", {
    ...event,
    clientX: origin.x,
    clientY: origin.y,
  });
  await canvas.dispatchEvent("pointermove", {
    ...event,
    clientX: origin.x + 30,
    clientY: origin.y + 20,
  });
  await canvas.dispatchEvent("pointerup", {
    ...event,
    buttons: 0,
    clientX: origin.x + 100,
    clientY: origin.y + 80,
    shiftKey: true,
  });
  await expectInk(canvas, 0.2 + 50 / box.width, 0.4 + 100 / box.height);
  await expectInk(canvas, 0.2 + 15 / box.width, 0.4 + 20 / box.height, false);
});

test("单击、过小拖动、Esc、指针取消与失焦不留下内容或撤销步骤", async ({
  page,
}) => {
  const board = await openBoard(page);
  await selectShape(board, "箭头");
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const start = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 };
  const use = board.getByRole("button", { name: "使用草图", exact: true });
  await page.keyboard.down("Shift");
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 1, start.y + 1);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(use).toBeDisabled();
  for (const reason of ["escape", "pointercancel", "blur"] as const) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y);
    await expectInk(canvas, 0.2 + 50 / box.width, 0.5);
    if (reason === "escape") await page.keyboard.press("Escape");
    else if (reason === "pointercancel")
      await canvas.dispatchEvent("pointercancel", {
        pointerId: 1,
        pointerType: "mouse",
      });
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    await expectInk(canvas, 0.2 + 50 / box.width, 0.5, false);
    await expect(use).toBeDisabled();
    await expect(
      board.getByRole("button", { name: "撤销", exact: true }),
    ).toBeDisabled();
  }
});

for (const english of [false, true]) {
  test.describe(english ? "英文形状面板" : "中文形状面板", () => {
    test.use({ locale: english ? "en-US" : "zh-CN", hasTouch: true });
    test("双指缩放平移不误画，放大后绘制与导出坐标不变，可键盘复位", async ({
      page,
    }, testInfo) => {
      const width = english ? 320 : 390;
      await page.setViewportSize({ width, height: 844 });
      const board = await openBoard(page, english);
      await board
        .getByRole("slider", {
          name: english ? "Tool size" : "工具大小",
          exact: true,
        })
        .press("End");
      const canvas = board.locator("canvas");
      const initial = (await canvas.boundingBox())!;
      const center = {
        x: initial.x + initial.width / 2,
        y: initial.y + initial.height / 2,
      };
      const fit = board.getByRole("button", {
        name: english ? "Fit to screen" : "适应屏幕",
        exact: true,
      });
      const undo = board.getByRole("button", {
        name: english ? "Undo" : "撤销",
        exact: true,
      });
      const session = await page.context().newCDPSession(page);
      const touch = (
        type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
        points: (Point & { id: number })[],
      ) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      const pair = (distance: number, x = 0, y = 0) => [
        { id: 1, x: center.x + x - distance / 2, y: center.y + y },
        { id: 2, x: center.x + x + distance / 2, y: center.y + y },
      ];

      // 第一指已有临时笔迹，第二指按下时必须完整回滚。
      await touch("touchStart", [pair(40)[0]]);
      await touch("touchMove", [pair(60)[0]]);
      await touch("touchStart", pair(60));
      await touch("touchMove", pair(120));
      await expect(fit).toHaveText("200%");
      await expect(undo).toBeDisabled();
      await expectInk(canvas, 0.5, 0.5, false);
      const zoomed = (await canvas.boundingBox())!;
      expect(zoomed.width).toBeCloseTo(initial.width * 2, 0);
      await touch("touchMove", pair(120, 20, 25));
      await expect
        .poll(async () => (await canvas.boundingBox())!.x - zoomed.x)
        .toBeCloseTo(20, 0);
      const moved = (await canvas.boundingBox())!;
      expect(moved.x - zoomed.x).toBeCloseTo(20, 0);
      expect(moved.y - zoomed.y).toBeCloseTo(25, 0);
      await touch("touchEnd", [pair(120, 20, 25)[0]]);
      await touch("touchMove", [{ id: 1, x: center.x, y: center.y }]);
      await touch("touchEnd", []);
      await expect(undo).toBeDisabled();
      const empty = await canvas.evaluate((element) => {
        const cv = element as HTMLCanvasElement;
        return cv
          .getContext("2d")!
          .getImageData(0, 0, cv.width, cv.height)
          .data.some((channel, i) => i % 4 === 3 && channel > 0);
      });
      expect(empty).toBe(false);

      // 缩放后的单指笔迹落在手指对应的逻辑坐标，PNG 仍为原尺寸。
      const from = { id: 1, x: center.x - 25, y: center.y };
      const to = { id: 1, x: center.x + 25, y: center.y };
      await touch("touchStart", [from]);
      await touch("touchMove", [to]);
      await touch("touchEnd", []);
      const logical = {
        x: (center.x - moved.x) / moved.width,
        y: (center.y - moved.y) / moved.height,
      };
      await expectInk(canvas, logical.x, logical.y);
      await expect(undo).toBeEnabled();

      // 橡皮预览在第二指落下时还原，形状预览也不生成额外撤销项。
      for (const tool of [
        english ? "Eraser" : "橡皮",
        english ? "Shapes" : "形状",
      ]) {
        await board.getByRole("button", { name: tool, exact: true }).click();
        await touch("touchStart", [{ id: 1, ...center }]);
        await touch("touchMove", [pair(40)[0]]);
        await touch("touchStart", pair(40));
        await touch("touchCancel", []);
        await expectInk(canvas, logical.x, logical.y);
      }
      await undo.click();
      await expect(undo).toBeDisabled();
      await board
        .getByRole("button", { name: english ? "Redo" : "重做", exact: true })
        .click();
      await expectInk(canvas, logical.x, logical.y);

      // 放大后形状与橡皮也使用手指下的原文档坐标。
      const shapeFrom = { id: 1, x: center.x - 30, y: center.y + 45 };
      const shapeTo = { id: 1, x: center.x + 30, y: center.y + 80 };
      await touch("touchStart", [shapeFrom]);
      await touch("touchMove", [shapeTo]);
      await touch("touchEnd", []);
      await expectInk(
        canvas,
        logical.x,
        (shapeFrom.y - moved.y) / moved.height,
      );
      await undo.click();
      await expectInk(
        canvas,
        logical.x,
        (shapeFrom.y - moved.y) / moved.height,
        false,
      );
      await board
        .getByRole("button", { name: english ? "Eraser" : "橡皮", exact: true })
        .click();
      await touch("touchStart", [{ id: 1, ...center }]);
      await touch("touchEnd", []);
      await expectInk(canvas, logical.x, logical.y, false);
      await undo.click();
      await expectInk(canvas, logical.x, logical.y);

      // 极端捏合限制到 400%；纸面外的第二指同样能参与手势。
      await touch("touchStart", pair(40));
      await touch("touchMove", pair(200));
      await expect(fit).toHaveText("400%");
      await touch("touchEnd", []);
      await board.screenshot({
        path: testInfo.outputPath("sketch-zoom-mobile.png"),
      });
      await fit.focus();
      await page.keyboard.press("Enter");
      await expect(fit).toHaveText("100%");
      expect((await canvas.boundingBox())!.width).toBeCloseTo(initial.width, 0);
      await expectInk(canvas, logical.x, logical.y);
      await touch("touchStart", pair(40));
      await touch("touchMove", pair(80));
      await touch("touchEnd", []);
      await page.setViewportSize({ width: width + 30, height: 790 });
      await expect(fit).toHaveText("100%");
      await expectInk(canvas, logical.x, logical.y);
      // 放大状态直接确认，导出不截成可见窗口。
      await touch("touchStart", pair(40));
      await touch("touchMove", pair(80));
      await touch("touchEnd", []);
      await board
        .getByRole("button", {
          name: english ? "Use sketch" : "使用草图",
          exact: true,
        })
        .click();
      const image = page.locator(".pm-bar-thumb img").first();
      await expect(image).toBeVisible();
      const exported = await image.evaluate(async (element, point) => {
        const img = element as HTMLImageElement;
        await img.decode();
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth;
        cv.height = img.naturalHeight;
        cv.getContext("2d")!.drawImage(img, 0, 0);
        return {
          width: cv.width,
          height: cv.height,
          pixel: [
            ...cv
              .getContext("2d")!
              .getImageData(
                Math.round(point.x * cv.width),
                Math.round(point.y * cv.height),
                1,
                1,
              ).data,
          ],
          corner: [...cv.getContext("2d")!.getImageData(0, 0, 1, 1).data],
        };
      }, logical);
      expect(exported.width).toBe(1536);
      expect(exported.height).toBe(1024);
      expect(exported.pixel.slice(0, 3)).toEqual([26, 26, 26]);
      expect(exported.corner).toEqual([255, 255, 255, 255]);
      await session.detach();
    });
    test("窄屏按钮不重叠且至少 44px，可用键盘选择与关闭，触摸可绘制", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const board = await openBoard(page, english);
      const shape = board.getByRole("button", {
        name: english ? "Shapes" : "形状",
        exact: true,
      });
      const panel = board.getByRole("group", {
        name: english ? "Shape options" : "形状选项",
        exact: true,
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await shape.focus();
        await page.keyboard.press("Space");
        await expect(panel).toBeVisible();
        const bounds = (await panel.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        const buttons = await panel.getByRole("button").all();
        const boxes = await Promise.all(
          buttons.map((button) => button.boundingBox()),
        );
        for (const [index, box] of boxes.entries()) {
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          for (const other of boxes.slice(index + 1)) {
            expect(
              Math.min(box!.x + box!.width, other!.x + other!.width) <=
                Math.max(box!.x, other!.x) ||
                Math.min(box!.y + box!.height, other!.y + other!.height) <=
                  Math.max(box!.y, other!.y),
            ).toBe(true);
          }
        }
        const ellipse = panel.getByRole("button", {
          name: english ? "Ellipse" : "椭圆",
          exact: true,
        });
        await ellipse.focus();
        await page.keyboard.press("Enter");
        await expect(ellipse).toHaveAttribute("aria-pressed", "true");
        await panel
          .getByRole("button", {
            name: english ? "Filled" : "实心",
            exact: true,
          })
          .click();
        if (english) {
          const text = await panel.evaluate(
            (el) =>
              el.textContent +
              Array.from(el.querySelectorAll("[aria-label]"))
                .map((el) => el.getAttribute("aria-label"))
                .join(" "),
          );
          expect(text).not.toMatch(/[\u3400-\u9fff]/);
        }
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(shape).toBeFocused();
      }
      const canvas = board.locator("canvas");
      const box = (await canvas.boundingBox())!;
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: box.x + box.width * 0.2, y: box.y + box.height * 0.5 },
        ],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: box.x + box.width * 0.7, y: box.y + box.height * 0.8 },
        ],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
      await expectInk(canvas, 0.45, 0.65);
      await expect(
        board.getByRole("button", {
          name: english ? "Use sketch" : "使用草图",
          exact: true,
        }),
      ).toBeEnabled();
    });
  });
}
