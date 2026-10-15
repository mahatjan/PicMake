/// <reference lib="dom" />
// page.evaluate 的回调在浏览器里执行，用到 document 的类型
import { expect, test, type Page } from "@playwright/test";
import { MOCK, solidPng } from "./helpers.ts";

// 多尺寸生成冒烟（中文界面，只用 mock API）：每个比例一个独立请求，同时发出，结果合成一条记录。
// mock 的标记：[json] 直接回 JSON（快）；[slow] 放慢；[429@宽x高] 只让该尺寸的请求报 429（部分失败）。

const prompt = (page: Page) => page.getByRole("textbox", { name: "画面描述" });
const generate = (page: Page) => page.getByRole("button", { name: "生成图片" });
const done = (page: Page) => page.getByText("生成完成 · 已保存本地");
const sizeChip = (page: Page) =>
  page.getByRole("button", { name: "比例与基准" });
const countChip = (page: Page) =>
  page.getByRole("button", { name: "生成张数" });

const PRESETS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];

async function configure(page: Page) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("API 地址").fill(MOCK);
  await dialog.getByLabel("API Key", { exact: true }).fill("mock-key");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "展开并生成" }).click();
  await expect(prompt(page)).toBeVisible();
}

/** 打开比例弹层，开启多比例并选好比例。开启时默认选中 3:2：已满 4 个时先取消一个多余的，
 *  最后再取消剩下多余的（至少保留 1 个） */
async function selectRatios(page: Page, ratios: string[]) {
  await sizeChip(page).click();
  const pop = page.getByRole("dialog", { name: "比例与基准" });
  const multi = pop.getByRole("switch", { name: "多比例" });
  if ((await multi.getAttribute("aria-checked")) !== "true")
    await multi.click();
  const chip = (id: string) =>
    pop.getByRole("button", { name: id, exact: true });
  const pressed = async (id: string) =>
    (await chip(id).getAttribute("aria-pressed")) === "true";
  const selected = () =>
    pop.locator('.pm-pop-ratio button[aria-pressed="true"]');
  for (const id of ratios) {
    if (await pressed(id)) continue;
    if ((await selected().count()) >= 4) {
      for (const other of PRESETS)
        if (!ratios.includes(other) && (await pressed(other))) {
          await chip(other).click();
          break;
        }
    }
    await chip(id).click();
  }
  for (const id of PRESETS)
    if (
      !ratios.includes(id) &&
      (await pressed(id)) &&
      (await selected().count()) > 1
    )
      await chip(id).click();
  return pop;
}

/** 点弹层外收起它 */
const closePopover = (page: Page) => page.mouse.click(40, 420);

test("选 3 个比例生成：一条记录三张图，按比例顺序排列并标注尺寸", async ({
  page,
}) => {
  await configure(page);
  await selectRatios(page, ["16:9", "1:1", "9:16"]);
  // 值 chip 与张数：N 个比例 · 基准；张数不可用，总张数就是比例数
  await expect(sizeChip(page)).toContainText("3 个比例 · 1K");
  await expect(countChip(page)).toBeDisabled();
  await expect(countChip(page)).toContainText("×3");
  await closePopover(page);

  await prompt(page).fill("三种比例 [json]");
  await generate(page).click();
  await expect(done(page)).toBeVisible();

  // 与点选先后无关：按 1:1、16:9、9:16 的 chip 顺序，每张下方标注比例与像素
  await expect(page.locator(".pm-mcap")).toHaveText([
    "1:1 · 1024 × 1024",
    "16:9 · 1792 × 1008",
    "9:16 · 1008 × 1792",
  ]);
  await expect(page.getByText("共 3 个尺寸")).toBeVisible();
  // 再来一版按钮标出份数，避免意外计费
  await expect(
    page.getByRole("button", { name: "再来一版 · 3 个尺寸" }),
  ).toBeVisible();
  // 详情浮卡：尺寸列出每张图的实际像素，没有张数
  const detail = page.getByLabel("本次生成详情");
  await expect(detail.getByText("1792 × 1008")).toBeVisible();
  await expect(detail.getByText("张数")).toBeHidden();

  // 历史里只有一条记录、3 张
  await page.getByRole("button", { name: "历史" }).click();
  const drawer = page.getByRole("dialog", { name: "生成历史" });
  await expect(drawer.getByText("3 张")).toHaveCount(1);
  await expect(drawer.locator(".pm-drow")).toHaveCount(1);
});

test("点图弹轮播：显示当前图的尺寸，循环切换后关闭", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9"]);
  await closePopover(page);
  await prompt(page).fill("轮播 [json]");
  await generate(page).click();
  await expect(done(page)).toBeVisible();

  await page.getByRole("button", { name: "结果 2" }).click();
  const carousel = page.getByRole("dialog", { name: "查看图片" });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByText("2 / 2")).toBeVisible();
  await expect(carousel.getByText("16:9 · 1792 × 1008")).toBeVisible();
  await carousel.getByRole("button", { name: "下一张" }).click();
  await expect(carousel.getByText("1 / 2")).toBeVisible();
  await expect(carousel.getByText("1:1 · 1024 × 1024")).toBeVisible();
  await carousel.getByRole("button", { name: "关闭轮播" }).click();
  await expect(carousel).toBeHidden();
});

test("部分失败：成功的入库并展示，toast 列出失败的比例与原因，详情标出未生成", async ({
  page,
}) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
  await prompt(page).fill("部分失败 [json] [429@1792x1008]");
  await generate(page).click();

  await expect(page.getByText("已生成 2/3 个尺寸")).toBeVisible();
  await expect(page.getByText("16:9：请求过于频繁")).toBeVisible();
  // 失败的格子移除，舞台只展示入库的图
  await expect(page.locator(".pm-mcap")).toHaveText([
    "1:1 · 1024 × 1024",
    "9:16 · 1008 × 1792",
  ]);
  await expect(page.getByText("未生成：16:9")).toBeVisible();
  await page.getByRole("button", { name: "历史" }).click();
  await expect(
    page.getByRole("dialog", { name: "生成历史" }).getByText("2 张"),
  ).toBeVisible();
});

test("全部失败：只弹一条错误提示，不入库，草稿保留", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
  await prompt(page).fill("全部失败 [401]");
  await generate(page).click();

  await expect(page.getByText(/API Key 无效/)).toHaveCount(1);
  await expect(prompt(page)).toHaveValue("全部失败 [401]");
  await expect(sizeChip(page)).toContainText("3 个比例");
  await page.getByRole("button", { name: "历史" }).click();
  await expect(
    page.getByRole("dialog", { name: "生成历史" }).getByText("全部失败 [401]"),
  ).toBeHidden();
});

test("生成中每格各自进度，失败的格子显示失败标记，其余继续", async ({
  page,
}) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
  await prompt(page).fill("失败标记 [500@1008x1792] [slow@1792x1008]");
  await generate(page).click();

  await expect(page.getByText("正在生成 · 已完成 0/3")).toBeVisible();
  // 9:16 失败、1:1 完成，16:9（放慢）还在生成
  await expect(page.getByText("生成失败")).toBeVisible();
  await expect(page.getByText("服务端暂时不可用")).toBeVisible();
  await expect(page.getByText("正在生成 · 已完成 1/3")).toBeVisible();
  await expect(page.locator(".pm-mtile.done")).toHaveCount(1);
  await expect(page.locator(".pm-mtile.running")).toHaveCount(1);
  await page.getByRole("button", { name: "取消生成" }).click();
});

test("生成中取消：未完成的中止，已完成的照常保存", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
  await prompt(page).fill("取消保留 [slow@1792x1008]");
  await generate(page).click();

  // 1:1 与 9:16 先完成，16:9 被放慢
  await expect(page.getByText("正在生成 · 已完成 2/3")).toBeVisible();
  await page.getByRole("button", { name: "取消生成" }).click();

  await expect(page.getByText("已取消，已完成的 2 张已保存")).toBeVisible();
  await expect(page.locator(".pm-mcap")).toHaveText([
    "1:1 · 1024 × 1024",
    "9:16 · 1008 × 1792",
  ]);
  await page.getByRole("button", { name: "历史" }).click();
  await expect(
    page.getByRole("dialog", { name: "生成历史" }).getByText("2 张"),
  ).toBeVisible();
});

test("生成中取消且一张都没完成：同单尺寸取消，草稿保留", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9"]);
  await closePopover(page);
  await prompt(page).fill("全部放慢 [slow]");
  await generate(page).click();
  await page.getByRole("button", { name: "取消生成" }).click();

  await expect(page.getByText("已取消生成")).toBeVisible();
  await expect(prompt(page)).toHaveValue("全部放慢 [slow]");
  await expect(page.getByText("生成完成 · 已保存本地")).toBeHidden();
});

test("比例弹层：最多选 4 个，自动与自定义不可用，关闭后只保留靠前的比例", async ({
  page,
}) => {
  await configure(page);
  const pop = await selectRatios(page, ["16:9", "9:16", "4:3", "1:1"]);
  await expect(pop.getByText("最多选 4 个比例")).toBeVisible();
  for (const id of ["3:4", "3:2", "2:3"])
    await expect(
      pop.getByRole("button", { name: id, exact: true }),
    ).toBeDisabled();
  // 选满后仍可取消已选的
  await expect(
    pop.getByRole("button", { name: "16:9", exact: true }),
  ).toBeEnabled();
  await expect(pop.getByRole("button", { name: "自动" })).toBeDisabled();
  await expect(pop.getByLabel("自定义宽度")).toBeDisabled();
  await expect(pop.getByText("每个比例单独请求、分别计费")).toBeVisible();
  await expect(sizeChip(page)).toContainText("4 个比例 · 1K");

  // 至少保留 1 个：逐个取消，最后一个点不掉
  for (const id of ["16:9", "9:16", "4:3"])
    await pop.getByRole("button", { name: id, exact: true }).click();
  await pop.getByRole("button", { name: "1:1", exact: true }).click();
  await expect(
    pop.getByRole("button", { name: "1:1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // 只剩 1 个比例：与单选显示相同，张数 chip 恢复可用
  await expect(sizeChip(page)).toContainText("1:1 · 1K");
  await expect(countChip(page)).toBeEnabled();

  // 再选两个，关闭多比例：只保留顺序最靠前的那个
  await pop.getByRole("button", { name: "9:16", exact: true }).click();
  await pop.getByRole("button", { name: "16:9", exact: true }).click();
  await pop.getByRole("switch", { name: "多比例" }).click();
  await expect(sizeChip(page)).toContainText("1:1 · 1K");
  await expect(pop.getByRole("button", { name: "自动" })).toBeEnabled();
});

test("再来一版按全部比例重发，微调描述还原多比例设置", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["4:3", "2:3", "16:9"]);
  // 基准 2K
  const pop = page.getByRole("dialog", { name: "比例与基准" });
  await pop
    .getByRole("group", { name: "基准分辨率" })
    .getByRole("button", { name: "2K" })
    .click();
  await closePopover(page);
  await prompt(page).fill("复用 [json]");
  await generate(page).click();
  await expect(page.locator(".pm-mcap")).toHaveText([
    "4:3 · 2720 × 2048",
    "2:3 · 2048 × 3072",
    "16:9 · 3584 × 2016",
  ]);

  // 微调描述：回填多比例开关、所选比例与基准
  await page.getByRole("button", { name: "微调描述" }).click();
  await expect(sizeChip(page)).toContainText("3 个比例 · 2K");
  await sizeChip(page).click();
  const restored = page.getByRole("dialog", { name: "比例与基准" });
  await expect(
    restored.getByRole("switch", { name: "多比例" }),
  ).toHaveAttribute("aria-checked", "true");
  for (const id of ["4:3", "2:3", "16:9"])
    await expect(
      restored.getByRole("button", { name: id, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  await closePopover(page);
});

test("再来一版：同样的 3 个比例再发一次，历史新增一条", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
  await prompt(page).fill("再来一版 [json]");
  await generate(page).click();
  await expect(done(page)).toBeVisible();
  await page.getByRole("button", { name: "再来一版 · 3 个尺寸" }).click();

  await page.getByRole("button", { name: "历史" }).click();
  const drawer = page.getByRole("dialog", { name: "生成历史" });
  await expect(drawer.locator(".pm-drow")).toHaveCount(2);
  await expect(drawer.getByText("3 张")).toHaveCount(2);
});

test("4 个横向比例折成两行，格子不超出舞台、不压到详情浮卡、没有横向滚动", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await configure(page);
  await selectRatios(page, ["1:1", "4:3", "3:2", "16:9"]);
  await closePopover(page);
  await prompt(page).fill("折行 [json]");
  await generate(page).click();
  await expect(done(page)).toBeVisible();

  const tiles = page.locator(".pm-gtile");
  await expect(tiles).toHaveCount(4);
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }),
  );
  // 前两张同一行、后两张在下一行
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
  expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(2);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].bottom);
  const card = (await page.locator(".pm-detail").boundingBox())!;
  for (const box of boxes) {
    expect(box.right).toBeLessThanOrEqual(card.x);
    expect(box.y).toBeGreaterThanOrEqual(60); // 不压到顶部的 toast / 状态胶囊
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("生成中关闭或刷新页面会弹出浏览器的离开确认", async ({ page }) => {
  await configure(page);
  await prompt(page).fill("离开确认 [slow]");
  await generate(page).click();
  await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();

  const dialogEvent = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await dialogEvent;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss(); // 留在页面上
});

test("没有进行中的生成时关闭页面不弹确认", async ({ page }) => {
  await configure(page);
  await prompt(page).fill("已完成 [json]");
  await generate(page).click();
  await expect(done(page)).toBeVisible();

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => dialogs.push(dialog.type()));
  const closed = page.waitForEvent("close");
  await page.close({ runBeforeUnload: true });
  await closed;
  expect(dialogs).toEqual([]);
});

test("带参考图也能多比例：添加输入图后保持多比例，每个比例一张结果", async ({
  page,
}) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9"]);
  await closePopover(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "ref.png",
    mimeType: "image/png",
    buffer: solidPng(256, 256),
  });
  // 添加第一张输入图不会把比例改成「自动」
  await expect(sizeChip(page)).toContainText("2 个比例 · 1K");
  // 有输入图时描述框叫「修改描述」
  await page
    .getByRole("textbox", { name: "修改描述" })
    .fill("参考图适配 [json]");
  await page.getByRole("button", { name: "生成编辑结果" }).click();
  await expect(done(page)).toBeVisible();
  await expect(page.locator(".pm-mcap")).toHaveText([
    "1:1 · 1024 × 1024",
    "16:9 · 1792 × 1008",
  ]);
});

test("进入局部重绘：多比例自动关闭，开关不可用", async ({ page }) => {
  await configure(page);
  await selectRatios(page, ["1:1", "16:9", "9:16"]);
  await closePopover(page);
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
    steps: 6,
  });
  await page.mouse.up();
  await board.getByRole("button", { name: "使用选区" }).click();
  await expect(board).toBeHidden();

  // 退回单选，张数 chip 恢复可用（重绘支持 1–4 张）
  await expect(sizeChip(page)).not.toContainText("个比例");
  await expect(countChip(page)).toBeEnabled();
  await sizeChip(page).click();
  const pop = page.getByRole("dialog", { name: "比例与基准" });
  const multi = pop.getByRole("switch", { name: "多比例" });
  await expect(multi).toBeDisabled();
  await expect(multi).toHaveAttribute("aria-checked", "false");
  await expect(pop.getByText("局部重绘不支持多比例")).toBeVisible();
});
