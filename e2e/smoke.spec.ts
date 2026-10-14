import { expect, test, type Page } from "@playwright/test";
import { MOCK, solidPng } from "./helpers.ts";

const prompt = (page: Page) => page.getByRole("textbox", { name: "画面描述" });
const generate = (page: Page) => page.getByRole("button", { name: "生成图片" });

/** locator.boundingBox() 返回的包围盒 */
type Box = { x: number; y: number; width: number; height: number };

/** 首次进入：没有 Key 时自动弹出设置；填入 mock 地址并保存 */
async function configure(page: Page) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("API 地址").fill(MOCK);
  await dialog.getByLabel("API Key").fill("mock-key");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
}

/** 创作条初始是收起态：展开后才有描述框 */
async function expandBar(page: Page) {
  await page.getByRole("button", { name: "展开并生成" }).click();
  await expect(prompt(page)).toBeVisible();
}

test("首次进入引导配置，保存后可以继续使用", async ({ page }) => {
  await configure(page);
  await expect(page.getByText("设置已保存")).toBeVisible();
  await expandBar(page);
});

test("输入描述生成图片，完成后保存到本地历史", async ({ page }) => {
  await configure(page);
  await expandBar(page);
  await prompt(page).fill("雪夜的山顶小屋");
  await generate(page).click();
  await expect(page.getByText("生成完成 · 已保存本地")).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  const drawer = page.getByRole("dialog", { name: "生成历史" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("雪夜的山顶小屋")).toBeVisible();
});

test("终稿只给图片 URL 时也能下载入库（中转不发 b64_json）", async ({
  page,
}) => {
  await configure(page);
  await expandBar(page);
  await prompt(page).fill("只给 URL 的中转 [url]");
  await generate(page).click();
  await expect(page.getByText("生成完成 · 已保存本地")).toBeVisible();

  await page.getByRole("button", { name: "历史" }).click();
  const drawer = page.getByRole("dialog", { name: "生成历史" });
  await expect(drawer.getByText("只给 URL 的中转")).toBeVisible();
  // 缩略图是 background-image 的 div：取出 blob URL 真解码一次，
  // 才能证明「URL → 下载 → base64 → Blob」这条链路存下来的是可用图片
  const thumb = drawer.locator(".pm-dthumb").first();
  const width = await thumb.evaluate(async (el) => {
    const m = /url\("?(.+?)"?\)/.exec(getComputedStyle(el).backgroundImage);
    if (!m) return 0;
    return await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => resolve(0);
      img.src = m[1];
    });
  });
  expect(width).toBeGreaterThan(0);
});

test("生成中可以取消，取消后回到可输入状态且草稿保留", async ({ page }) => {
  await configure(page);
  await expandBar(page);
  await prompt(page).fill("慢速生成 [slow]");
  await generate(page).click();
  const cancel = page.getByRole("button", { name: "取消生成" });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toBeHidden();
  await expect(prompt(page)).toHaveValue("慢速生成 [slow]");
  await expect(page.getByText("生成完成 · 已保存本地")).toBeHidden();
});

test("服务端返回 401：提示 Key 问题，草稿保留，不产生历史", async ({
  page,
}) => {
  await configure(page);
  await expandBar(page);
  await prompt(page).fill("错误场景 [401]");
  await generate(page).click();
  await expect(page.getByText(/API Key 无效/)).toBeVisible();
  await expect(prompt(page)).toHaveValue("错误场景 [401]");

  await page.getByRole("button", { name: "历史" }).click();
  const drawer = page.getByRole("dialog", { name: "生成历史" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("错误场景 [401]")).toBeHidden();
});

test("画一张草图并确认：作为输入图落进创作条", async ({ page }) => {
  await configure(page);
  await expandBar(page);
  await page.getByRole("button", { name: "添加输入" }).click();
  await page.getByRole("button", { name: /画草图/ }).click();

  const board = page.getByRole("dialog", { name: "草图画板" });
  await expect(board).toBeVisible();
  const canvas = board.locator("canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();

  await board.getByRole("button", { name: "使用草图" }).click();
  await expect(board).toBeHidden();
  await expect(page.getByRole("button", { name: "移除图1" })).toBeVisible();
});

test("窄屏下选区编辑器的浮动控件互不重叠，也不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await configure(page);
  await expandBar(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "base.png",
    mimeType: "image/png",
    buffer: solidPng(256, 256),
  });
  await page.getByRole("button", { name: "对图1发起局部重绘" }).click();

  const board = page.getByRole("dialog", { name: "选择修改区域" });
  await expect(board).toBeVisible();
  const viewport = page.viewportSize()!;
  // 关闭键、标题、历史条、缩放条、工具条、确认按钮：两两不相交，且都在视口内
  const parts = [
    board.locator(".pm-ip-close"),
    board.locator(".pm-ip-title"),
    board.locator(".pm-ip-hist"),
    board.locator(".pm-ip-zoombar"),
    board.locator(".pm-ip-tools"),
    board.locator(".pm-ip-use"),
  ];
  const boxes: { name: string; b: Box }[] = [];
  for (const part of parts) {
    const b = (await part.boundingBox())!;
    expect(b, "控件应当可见").not.toBeNull();
    boxes.push({ name: (await part.getAttribute("class"))!, b });
  }
  for (const { name, b } of boxes) {
    expect(b.x, `${name} 左侧溢出`).toBeGreaterThanOrEqual(-0.5);
    expect(b.y, `${name} 顶部溢出`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, `${name} 右侧溢出`).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(b.y + b.height, `${name} 底部溢出`).toBeLessThanOrEqual(
      viewport.height + 0.5,
    );
  }
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b;
      const c = boxes[j].b;
      const overlap =
        a.x < c.x + c.width &&
        c.x < a.x + a.width &&
        a.y < c.y + c.height &&
        c.y < a.y + a.height;
      if (overlap) hits.push(`${boxes[i].name} × ${boxes[j].name}`);
    }
  expect(hits, "浮动控件重叠：" + hits.join(", ")).toEqual([]);
});

test("窄屏下草图画板的浮动控件互不重叠，也不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await configure(page);
  await expandBar(page);
  await page.getByRole("button", { name: "添加输入" }).click();
  await page.getByRole("button", { name: /画草图/ }).click();

  const board = page.getByRole("dialog", { name: "草图画板" });
  await expect(board).toBeVisible();
  const viewport = page.viewportSize()!;
  const parts = [
    board.locator(".pm-sk-close"),
    board.locator(".pm-sk-pill"),
    board.locator(".pm-sk-hist"),
    board.locator(".pm-sk-sizer-wrap"),
    board.locator(".pm-sk-colors"),
    board.locator(".pm-sk-use"),
  ];
  const boxes: { name: string; b: Box }[] = [];
  for (const part of parts) {
    const b = (await part.boundingBox())!;
    boxes.push({ name: (await part.getAttribute("class"))!, b });
  }
  for (const { name, b } of boxes) {
    expect(b.x, `${name} 左侧溢出`).toBeGreaterThanOrEqual(-0.5);
    expect(b.y, `${name} 顶部溢出`).toBeGreaterThanOrEqual(-0.5);
    expect(b.x + b.width, `${name} 右侧溢出`).toBeLessThanOrEqual(
      viewport.width + 0.5,
    );
    expect(b.y + b.height, `${name} 底部溢出`).toBeLessThanOrEqual(
      viewport.height + 0.5,
    );
  }
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b;
      const c = boxes[j].b;
      if (
        a.x < c.x + c.width &&
        c.x < a.x + a.width &&
        a.y < c.y + c.height &&
        c.y < a.y + a.height
      )
        hits.push(`${boxes[i].name} × ${boxes[j].name}`);
    }
  expect(hits, "浮动控件重叠：" + hits.join(", ")).toEqual([]);
});

test("局部重绘：上传底图、涂选、生成，并能查看保存的选区", async ({ page }) => {
  await configure(page);
  await expandBar(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "base.png",
    mimeType: "image/png",
    buffer: solidPng(256, 256),
  });
  await page.getByRole("button", { name: "对图1发起局部重绘" }).click();

  const board = page.getByRole("dialog", { name: "选择修改区域" });
  await expect(board).toBeVisible();
  const box = (await board.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await board.getByRole("button", { name: "使用选区" }).click();
  await expect(board).toBeHidden();

  await page.getByRole("textbox", { name: "修改描述" }).fill("把中间换成红色");
  await page.getByRole("button", { name: "生成重绘结果" }).click();
  await expect(page.getByText("生成完成 · 已保存本地")).toBeVisible();

  await page.getByRole("button", { name: "查看选区" }).click();
  const view = page.getByRole("dialog", { name: "查看选区" });
  await expect(view).toBeVisible();
  await view.getByRole("button", { name: "关闭" }).click();
  await expect(view).toBeHidden();
});
