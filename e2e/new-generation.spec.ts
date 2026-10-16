import { expect, test } from "@playwright/test";
import { MOCK } from "./helpers.ts";

const locales = {
  "zh-CN": {
    settings: "设置",
    url: "API 地址",
    save: "保存",
    expand: "展开并生成",
    prompt: "画面描述",
    generate: "生成图片",
    cancelRun: "取消生成",
    done: "生成完成 · 已保存本地",
    newGeneration: "新建生成",
    discard: "放弃当前草稿？",
    cancel: "取消",
    continue: "继续",
    history: "历史",
    historyTitle: "生成历史",
  },
  en: {
    settings: "Settings",
    url: "API URL",
    save: "Save",
    expand: "Expand and generate",
    prompt: "Prompt",
    generate: "Generate image",
    cancelRun: "Cancel generation",
    done: "Generation complete · saved locally",
    newGeneration: "New generation",
    discard: "Discard the current draft?",
    cancel: "Cancel",
    continue: "Continue",
    history: "History",
    historyTitle: "Generation history",
  },
};

for (const [locale, text] of Object.entries(locales)) {
  for (const width of [1280, 375]) {
    test.describe(`${locale} · ${width}px`, () => {
      test.use({ locale, viewport: { width, height: 900 } });

      test("导航新建支持键盘、草稿确认及生成中禁用；有历史时刷新仍展示新建页面", async ({
        page,
      }, testInfo) => {
        await page.goto("/");
        const settings = page.getByRole("dialog", { name: text.settings });
        await settings.getByLabel(text.url).fill(MOCK);
        await settings.getByLabel("API Key", { exact: true }).fill("mock-key");
        await settings.getByRole("button", { name: text.save }).click();
        await expect(settings).toBeHidden();

        const stage = page.locator(".pm-stage");
        const newGeneration = page
          .getByRole("navigation")
          .getByRole("button", { name: text.newGeneration });
        const prompt = page.getByRole("textbox", { name: text.prompt });
        await expect(stage).toHaveAttribute("data-mode", "empty");
        await expect(newGeneration).toHaveAccessibleName(text.newGeneration);
        await page.getByRole("button", { name: text.expand }).click();
        await prompt.fill("navigation check [slow]");
        await page
          .getByRole("button", { name: text.generate, exact: true })
          .click();
        await expect(newGeneration).toBeDisabled();
        const cancelRun = page.getByRole("button", { name: text.cancelRun });
        await expect(cancelRun).toBeVisible();
        if (width < 760) {
          const navBox = (await page.getByRole("navigation").boundingBox())!;
          const pillBox = (await page.locator(".pm-gen-pill").boundingBox())!;
          expect(pillBox.y).toBeGreaterThan(navBox.y + navBox.height);
        }
        await page.screenshot({ path: testInfo.outputPath("generating.png") });
        await cancelRun.click();
        await expect(newGeneration).toBeEnabled();
        await expect(prompt).toHaveValue("navigation check [slow]");

        await prompt.fill("navigation saved result");
        await page
          .getByRole("button", { name: text.generate, exact: true })
          .click();
        await expect(page.getByText(text.done)).toBeVisible();
        await expect(stage).toHaveAttribute("data-mode", "single");
        await newGeneration.focus();
        await page.keyboard.press("Enter");
        await expect(stage).toHaveAttribute("data-mode", "empty");
        await expect(prompt).toHaveValue("");

        await prompt.fill("draft to keep");
        await newGeneration.click();
        const confirm = page.getByRole("alertdialog", { name: text.discard });
        await expect(confirm).toBeVisible();
        await confirm
          .getByRole("button", { name: text.cancel, exact: true })
          .click();
        await expect(prompt).toHaveValue("draft to keep");
        await newGeneration.click();
        await confirm
          .getByRole("button", { name: text.continue, exact: true })
          .click();
        await expect(prompt).toHaveValue("");

        await page.reload();
        await page
          .getByRole("button", { name: text.history, exact: true })
          .click();
        const history = page.getByRole("dialog", { name: text.historyTitle });
        await expect(
          history.getByText("navigation saved result"),
        ).toBeVisible();
        // 历史订阅已加载，但页面仍应保留新建状态。
        await expect(stage).toHaveAttribute("data-mode", "empty");
        await history.getByText("navigation saved result").click();
        await expect(history).toBeHidden();
        await expect(stage).toHaveAttribute("data-mode", "single");
        await newGeneration.click();
        await expect(stage).toHaveAttribute("data-mode", "empty");
        await page.screenshot({
          path: testInfo.outputPath("new-generation.png"),
        });
      });
    });
  }
}
