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
    barCancel: "取消",
    done: "生成完成 · 已保存本地",
    newGeneration: "首页",
    discard: "放弃当前草稿？",
    cancel: "取消",
    continue: "继续",
    history: "历史",
    historyTitle: "生成历史",
    video: "视频",
  },
  en: {
    settings: "Settings",
    url: "API URL",
    save: "Save",
    expand: "Expand and generate",
    prompt: "Prompt",
    generate: "Generate image",
    barCancel: "Cancel",
    done: "Generation complete · saved locally",
    newGeneration: "Home",
    discard: "Discard the current draft?",
    cancel: "Cancel",
    continue: "Continue",
    history: "History",
    historyTitle: "Generation history",
    video: "Video",
  },
};

for (const [locale, text] of Object.entries(locales)) {
  for (const width of [1280, 375]) {
    test.describe(`${locale} · ${width}px`, () => {
      test.use({ locale, viewport: { width, height: 900 } });

      test("导航新建支持键盘、草稿确认及后台生成；有历史时刷新仍展示新建页面", async ({
        page,
      }, testInfo) => {
        await page.goto("/");
        const settings = page.getByRole("dialog", { name: text.settings });
        await settings.getByLabel(text.url).fill(MOCK);
        await settings.getByLabel("API Key", { exact: true }).fill("mock-key");
        await settings.getByRole("button", { name: text.save }).click();
        await expect(settings).toBeHidden();

        const stage = page.locator(".pm-stage");
        const gallery = page.locator(".pm-gal");
        const newGeneration = page
          .getByRole("navigation")
          .getByRole("button", { name: text.newGeneration });
        const videoButton = page
          .getByRole("navigation")
          .getByRole("button", { name: text.video, exact: true });
        const video = page.getByRole("dialog", {
          name: text.video,
          exact: true,
        });
        const prompt = page.getByRole("textbox", { name: text.prompt });
        await expect(stage).toHaveAttribute("data-mode", "empty");
        await expect(newGeneration).toHaveAccessibleName(text.newGeneration);
        await page.getByRole("button", { name: text.expand }).click();
        await prompt.fill("navigation check [slow]");
        await page
          .getByRole("button", { name: text.generate, exact: true })
          .click();
        await expect(prompt).toHaveValue("");
        await prompt.fill("navigation check [slow]");
        await expect(newGeneration).toBeEnabled();
        await videoButton.click();
        await expect(video).toBeVisible();
        await newGeneration.click();
        await expect(video).toBeHidden();
        await expect(videoButton).toHaveAttribute("aria-pressed", "false");
        await expect(prompt).toHaveValue("navigation check [slow]");
        // 生成中停在画廊：取消入口在创作条上，生成卡在网格最前
        const cancelRun = page
          .locator(".pm-bar")
          .getByRole("button", { name: text.barCancel });
        await expect(cancelRun).toBeVisible();
        const genCard = page.locator(".pm-gal-card.is-gen");
        await expect(genCard).toBeVisible();
        if (width < 760) {
          const navBox = (await page.getByRole("navigation").boundingBox())!;
          const cardBox = (await genCard.boundingBox())!;
          expect(cardBox.y).toBeGreaterThan(navBox.y + navBox.height);
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
        // 生成完也留在画廊：不自动跳详情页
        await expect(gallery).toBeVisible();
        await videoButton.click();
        await expect(video).toBeVisible();
        await newGeneration.focus();
        await page.keyboard.press("Enter");
        await expect(video).toBeHidden();
        // 有历史时新建页面是作品画廊，不再是空状态引导
        await expect(stage).toHaveAttribute("data-mode", "home");
        await expect(gallery).toBeVisible();
        await expect(
          gallery.getByText("navigation saved result"),
        ).toBeVisible();
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
        await videoButton.click();
        await expect(video).toBeVisible();
        await page
          .getByRole("button", { name: text.history, exact: true })
          .click();
        const history = page.getByRole("dialog", { name: text.historyTitle });
        await expect(
          history.getByText("navigation saved result"),
        ).toBeVisible();
        // 视频页打开时画廊让位；选择历史后才回到对应图片结果。
        await expect(gallery).toBeHidden();
        await history.getByText("navigation saved result").click();
        await expect(history).toBeHidden();
        await expect(video).toBeHidden();
        await expect(videoButton).toHaveAttribute("aria-pressed", "false");
        await expect(stage).toHaveAttribute("data-mode", "single");
        await newGeneration.click();
        await expect(gallery).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath("new-generation.png"),
        });
      });
    });
  }
}
