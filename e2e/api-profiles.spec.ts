/// <reference lib="dom" />
import { expect, test, type Page } from "@playwright/test";
import { MOCK } from "./helpers.ts";

const locales = [
  {
    locale: "zh-CN",
    settings: "设置",
    profile: "API 配置",
    name: "配置名称",
    add: "新增配置",
    remove: "删除配置",
    base: "API 地址",
    save: "保存",
    test: "测试连接",
    connected: "连接成功",
    defaultProfile: "默认配置",
    expand: "展开并生成",
    prompt: "画面描述",
    generate: "生成图片",
    done: "生成完成 · 已保存本地",
  },
  {
    locale: "en-US",
    settings: "Settings",
    profile: "API profile",
    name: "Profile name",
    add: "Add profile",
    remove: "Delete profile",
    base: "API URL",
    save: "Save",
    test: "Test connection",
    connected: "Connected",
    defaultProfile: "Default profile",
    expand: "Expand and generate",
    prompt: "Prompt",
    generate: "Generate image",
    done: "Generation complete · saved locally",
  },
];

async function savedState(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("PicMake-settings")!).state,
  );
}

for (const text of locales) {
  test.describe(`API 配置 ${text.locale}`, () => {
    test.use({ locale: text.locale });

    test("命名组合、同地址不同 Key、键盘切换、连接测试和实际生成使用所选配置", async ({
      page,
    }) => {
      await page.goto("/");
      const dialog = page.getByRole("dialog", {
        name: text.settings,
        exact: true,
      });
      const select = dialog.getByRole("combobox", {
        name: text.profile,
        exact: true,
      });
      const base = dialog.getByLabel(text.base, { exact: true });
      const key = dialog.getByLabel("API Key", { exact: true });
      await expect(
        dialog.getByRole("button", { name: text.remove, exact: true }),
      ).toBeDisabled();
      await dialog.getByLabel(text.name, { exact: true }).fill("A profile");
      await base.fill(MOCK);
      await key.fill("Akey");
      await dialog.getByRole("button", { name: text.add, exact: true }).click();
      await dialog.getByLabel(text.name, { exact: true }).fill("xxx profile");
      await base.fill(MOCK);
      await key.fill("Bkey");
      await dialog.getByRole("button", { name: text.add, exact: true }).click();
      await dialog.getByLabel(text.name, { exact: true }).fill("sssss profile");
      await base.fill("http://127.0.0.1:8788");
      await key.fill("Ckey");

      await select.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(base).toHaveValue(MOCK);
      await expect(key).toHaveValue("Bkey");
      await expect(select.locator("option")).toHaveCount(3);
      const models = page.waitForRequest(
        (request) => request.url() === `${MOCK}/v1/models`,
      );
      await dialog
        .getByRole("button", { name: text.test, exact: true })
        .click();
      expect((await models).headers().authorization).toBe("Bearer Bkey");
      await expect(dialog.getByText(new RegExp(text.connected))).toBeVisible();
      await select.selectOption({ label: "A profile" });
      await expect(key).toHaveValue("Akey");
      await expect(dialog.getByText(new RegExp(text.connected))).toBeHidden();
      await select.selectOption({ label: "xxx profile" });
      await dialog
        .getByRole("button", { name: text.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();
      const saved = await savedState(page);
      expect(saved.apiProfiles).toHaveLength(3);
      expect(saved).toMatchObject({
        baseUrl: MOCK,
        apiKey: "Bkey",
        activeApiProfileId: saved.apiProfiles[1].id,
      });
      await page.reload();
      await page
        .getByRole("button", { name: text.settings, exact: true })
        .click();
      await expect(select.locator("option:checked")).toHaveText("xxx profile");
      await expect(key).toHaveValue("Bkey");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: text.expand, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: text.prompt, exact: true })
        .fill("a cabin");
      const generation = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url() === `${MOCK}/v1/images/generations`,
      );
      await page
        .getByRole("button", { name: text.generate, exact: true })
        .click();
      expect((await generation).headers().authorization).toBe("Bearer Bkey");
      await expect(page.getByText(text.done, { exact: true })).toBeVisible();
    });

    test("新增、编辑、切换和删除在关闭时放弃，保存删除后刷新仍生效", async ({
      page,
    }) => {
      await page.goto("/");
      const dialog = page.getByRole("dialog", {
        name: text.settings,
        exact: true,
      });
      const select = dialog.getByRole("combobox", {
        name: text.profile,
        exact: true,
      });
      const name = dialog.getByLabel(text.name, { exact: true });
      const key = dialog.getByLabel("API Key", { exact: true });
      await name.fill("Original");
      await dialog.getByLabel(text.base, { exact: true }).fill(MOCK);
      await key.fill("original-key");
      await dialog.getByRole("button", { name: text.add, exact: true }).click();
      await name.fill("Second");
      await key.fill("second-key");
      await dialog
        .getByRole("button", { name: text.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();
      const before = await savedState(page);
      await page
        .getByRole("button", { name: text.settings, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: text.remove, exact: true })
        .click();
      await name.fill("Unsaved edit");
      await key.fill("unsaved-key");
      await dialog.getByRole("button", { name: text.add, exact: true }).click();
      await name.fill("Unsaved new profile");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      expect(await savedState(page)).toEqual(before);
      await page
        .getByRole("button", { name: text.settings, exact: true })
        .click();
      await expect(select.locator("option:checked")).toHaveText("Second");
      await expect(key).toHaveValue("second-key");
      await dialog
        .getByRole("button", { name: text.remove, exact: true })
        .click();
      await expect(key).toHaveValue("original-key");
      await expect(
        dialog.getByRole("button", { name: text.remove, exact: true }),
      ).toBeDisabled();
      await dialog
        .getByRole("button", { name: text.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await page.reload();
      await page
        .getByRole("button", { name: text.settings, exact: true })
        .click();
      await expect(select.locator("option")).toHaveCount(1);
      await expect(name).toHaveValue("Original");
      await expect(key).toHaveValue("original-key");
    });

    test("旧设置迁移，中英文窄屏长名称布局和密码字段", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => {
        localStorage.setItem(
          "PicMake-settings",
          JSON.stringify({
            version: 0,
            state: {
              baseUrl: "http://localhost:8788",
              apiKey: "legacy-key",
              videoApiKey: "video-token",
              streamEnabled: false,
            },
          }),
        );
      });
      await page.goto("/");
      await page
        .getByRole("button", { name: text.settings, exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: text.settings,
        exact: true,
      });
      const select = dialog.getByRole("combobox", {
        name: text.profile,
        exact: true,
      });
      await expect(select.locator("option:checked")).toHaveText(
        text.defaultProfile,
      );
      const key = dialog.getByLabel("API Key", { exact: true });
      await expect(key).toHaveValue("legacy-key");
      await expect(key).toHaveAttribute("type", "password");
      await expect(dialog.getByLabel(text.base, { exact: true })).toHaveValue(
        MOCK,
      );
      await dialog
        .getByLabel(text.name, { exact: true })
        .fill("A very long profile name ".repeat(8));
      await expect(select.locator("option:checked")).toHaveText(
        /A very long profile name/,
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      if (text.locale === "en-US")
        expect(await dialog.innerText()).not.toMatch(/[\u3400-\u9fff]/);
      await select.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath("settings-profiles.png"),
      });
      await dialog
        .getByRole("button", { name: text.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();
      expect(await savedState(page)).toMatchObject({
        apiKey: "legacy-key",
        videoApiKey: "video-token",
        streamEnabled: false,
      });
    });
  });
}

test("切换配置后忽略上一个配置迟到的连接测试结果", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByLabel("API 地址", { exact: true }).fill(MOCK);
  await dialog.getByLabel("API Key", { exact: true }).fill("Akey");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/models", async (route) => {
    await gate;
    await route.fulfill({ json: { data: [{ id: "gpt-image-2.5" }] } });
  });
  try {
    const request = page.waitForRequest("**/v1/models");
    await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
    await request;
    await dialog.getByRole("button", { name: "新增配置", exact: true }).click();
    release();
    await expect(
      dialog.getByRole("button", { name: "测试连接", exact: true }),
    ).toBeEnabled();
    await expect(dialog.getByText(/连接成功/)).toBeHidden();
  } finally {
    release();
  }
});
