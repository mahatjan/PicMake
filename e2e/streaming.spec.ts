/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import { MOCK, solidPng } from "./helpers.ts";

const imageRequests = (page: Page) => {
  const bodies: { path: string; body: string }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/images\/(generations|edits)$/.test(request.url())
    )
      bodies.push({
        path: new URL(request.url()).pathname,
        body: request.postDataBuffer()?.toString() ?? "",
      });
  });
  return bodies;
};

async function configureWithoutStreaming(page: Page) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "设置" });
  await dialog.getByLabel("API 地址").fill(MOCK);
  await dialog.getByLabel("API Key", { exact: true }).fill("mock-key");
  await dialog.getByRole("switch", { name: "启用流式响应" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "展开并生成" }).click();
}

for (const locale of ["zh-CN", "en-US"]) {
  test.describe(`流式设置 ${locale}`, () => {
    test.use({ locale });
    test("默认开启，键盘切换后保存并刷新恢复，关闭弹窗不保存草稿", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const en = locale === "en-US";
      const labels = en
        ? {
            settings: "Settings",
            stream: "Enable streaming",
            base: "API URL",
            save: "Save",
            expand: "Expand and generate",
            prompt: "Prompt",
            generate: "Generate image",
            done: "Generation complete · saved locally",
          }
        : {
            settings: "设置",
            stream: "启用流式响应",
            base: "API 地址",
            save: "保存",
            expand: "展开并生成",
            prompt: "画面描述",
            generate: "生成图片",
            done: "生成完成 · 已保存本地",
          };
      const bodies = imageRequests(page);
      await page.goto("/");
      const dialog = page.getByRole("dialog", {
        name: labels.settings,
        exact: true,
      });
      const toggle = dialog.getByRole("switch", { name: labels.stream });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await dialog.getByLabel(labels.base).fill(MOCK);
      await dialog.getByLabel("API Key", { exact: true }).fill("mock-key");
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await dialog
        .getByRole("button", { name: labels.save, exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: labels.settings, exact: true })
        .click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page
        .getByRole("button", { name: labels.settings, exact: true })
        .click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: labels.expand }).click();
      await page
        .getByRole("textbox", { name: labels.prompt, exact: true })
        .fill("a snowy cabin");
      await page
        .getByRole("button", { name: labels.generate, exact: true })
        .click();
      await expect(page.getByText(labels.done, { exact: true })).toBeVisible();
      expect(bodies).toHaveLength(1);
      const fields = JSON.parse(bodies[0].body);
      expect(fields).not.toHaveProperty("stream");
      expect(fields).not.toHaveProperty("partial_images");

      await page
        .getByRole("button", { name: labels.settings, exact: true })
        .click();
      await toggle.click();
      await dialog
        .getByRole("button", { name: labels.save, exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: labels.settings, exact: true })
        .click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
    });
  });
}

test("旧设置缺少流式字段时保持默认开启", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "PicMake-settings",
      JSON.stringify({
        state: { baseUrl: "http://localhost:8788", apiKey: "mock-key" },
        version: 0,
      }),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "启用流式响应" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("关闭流式后多比例的每个请求都省略流式参数", async ({ page }) => {
  const bodies = imageRequests(page);
  await configureWithoutStreaming(page);
  await page.getByRole("button", { name: "比例与基准", exact: true }).click();
  const pop = page.getByRole("dialog", { name: "比例与基准", exact: true });
  await pop.getByRole("switch", { name: "多比例", exact: true }).click();
  await page.mouse.click(40, 420);
  await page
    .getByRole("textbox", { name: "画面描述", exact: true })
    .fill("several snowy cabins");
  await page.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(
    page.getByText("生成完成 · 已保存本地", { exact: true }),
  ).toBeVisible();
  expect(bodies.length).toBeGreaterThan(1);
  for (const { body } of bodies) {
    const fields = JSON.parse(body);
    expect(fields.n).toBe(1);
    expect(fields).not.toHaveProperty("stream");
    expect(fields).not.toHaveProperty("partial_images");
  }
});

test("非流式错误保留草稿且不自动重发", async ({ page }) => {
  const bodies = imageRequests(page);
  await configureWithoutStreaming(page);
  await page
    .getByRole("textbox", { name: "画面描述", exact: true })
    .fill("provider error [401]");
  await page.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(page.getByText(/API Key 无效/)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "画面描述", exact: true }),
  ).toHaveValue("provider error [401]");
  expect(bodies).toHaveLength(1);
  await expect(
    page.getByText("生成完成 · 已保存本地", { exact: true }),
  ).toBeHidden();
});

for (const inpaint of [false, true]) {
  test(`关闭流式后${inpaint ? "局部重绘" : "编辑"}以完整 JSON 返回并保存成功`, async ({
    page,
  }) => {
    const bodies = imageRequests(page);
    await configureWithoutStreaming(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: "base.png",
      mimeType: "image/png",
      buffer: solidPng(256, 256),
    });
    if (inpaint) {
      await page.getByRole("button", { name: "对图1发起局部重绘" }).click();
      const board = page.getByRole("dialog", { name: "选择修改区域" });
      const box = (await board.locator("canvas").boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
        steps: 8,
      });
      await page.mouse.up();
      await board.getByRole("button", { name: "使用选区" }).click();
    }
    await page
      .getByRole("textbox", {
        name: "修改描述",
        exact: true,
      })
      .fill("make the middle red");
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/v1/images/edits"),
    );
    await page
      .getByRole("button", {
        name: inpaint ? "生成重绘结果" : "生成编辑结果",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("生成完成 · 已保存本地", { exact: true }),
    ).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].path).toBe("/v1/images/edits");
    // Chromium 不提供带文件的 multipart 原始 body；字段与附件由 client.test.ts 验证。
    // mock 遇到非流式参数才回 JSON，在这里验证实际传输选择和完整保存流程。
    expect((await responsePromise).headers()["content-type"]).toContain(
      "application/json",
    );
  });
}

test("非流式等待期间仍可取消，取消后保留草稿", async ({ page }) => {
  await configureWithoutStreaming(page);
  let finishRequest!: () => void;
  const pending = new Promise<void>((resolve) => {
    finishRequest = resolve;
  });
  await page.route("**/v1/images/generations", async (route) => {
    await pending;
    await route.abort();
  });
  try {
    await page
      .getByRole("textbox", { name: "画面描述", exact: true })
      .fill("waiting for a full image");
    await page.getByRole("button", { name: "生成图片", exact: true }).click();
    await expect(page.locator(".pm-bar-genst")).toHaveText("正在生成");
    await expect(page.locator(".pm-bar-gennote")).toHaveText(
      "完成后自动保存到本地",
    );
    await page.getByRole("button", { name: "取消生成", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "画面描述", exact: true }),
    ).toHaveValue("waiting for a full image");
    await expect(
      page.getByText("生成完成 · 已保存本地", { exact: true }),
    ).toBeHidden();
  } finally {
    finishRequest();
  }
});
