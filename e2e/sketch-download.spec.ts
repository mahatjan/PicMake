/// <reference lib="dom" />
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
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
  await expect(board).toBeVisible();
  await board.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((a) => a.finished));
  });
  return board;
}

for (const english of [false, true]) {
  for (const mobile of [false, true]) {
    test.describe(`${english ? "英文" : "中文"} · ${mobile ? "手机" : "桌面"}草图保存`, () => {
      test.use({
        locale: english ? "en-US" : "zh-CN",
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
      });

      test("保存原尺寸白底 PNG，继续编辑、撤销后保存并使用草图", async ({
        page,
      }, testInfo) => {
        const board = await openBoard(page, english);
        const save = board.getByRole("button", {
          name: english ? "Save image" : "保存图片",
          exact: true,
        });
        await expect(save).toBeVisible();
        await expect(save).toBeDisabled();
        const canvas = board.locator("canvas").first();
        const box = (await canvas.boundingBox())!;
        const draw = async (y: number) => {
          await page.mouse.move(
            box.x + box.width * 0.3,
            box.y + box.height * y,
          );
          await page.mouse.down();
          await page.mouse.move(
            box.x + box.width * 0.7,
            box.y + box.height * y,
            { steps: 5 },
          );
          await page.mouse.up();
        };
        await draw(0.4);
        await expect(save).toBeEnabled();
        await save.focus();
        await expect(save).toBeFocused();
        const firstDownload = page.waitForEvent("download");
        await page.keyboard.press("Enter");
        const download = await firstDownload;
        expect(download.suggestedFilename()).toMatch(
          /^PicMake-sketch-.+-1536x1024\.png$/,
        );
        const first = await readFile((await download.path())!);
        expect(first.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect([first.readUInt32BE(16), first.readUInt32BE(20)]).toEqual([
          1536, 1024,
        ]);
        const pixels = await page.evaluate(async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const image = await createImageBitmap(
            new Blob([bytes], { type: "image/png" }),
          );
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          const sample = (x: number, y: number) =>
            Array.from(ctx.getImageData(x, y, 1, 1).data);
          const result = {
            corner: sample(0, 0),
            line: sample(
              Math.round(image.width * 0.5),
              Math.round(image.height * 0.4),
            ),
          };
          image.close();
          return result;
        }, first.toString("base64"));
        expect(pixels.corner).toEqual([255, 255, 255, 255]);
        expect(pixels.line).toEqual([26, 26, 26, 255]);
        await expect(board).toBeVisible();

        await draw(0.6);
        await board
          .getByRole("button", { name: english ? "Undo" : "撤销", exact: true })
          .click();
        const nextDownload = page.waitForEvent("download");
        await save.click();
        expect(await readFile((await (await nextDownload).path())!)).toEqual(
          first,
        );
        await page.screenshot({ path: testInfo.outputPath("sketch-save.png") });

        await board
          .getByRole("button", { name: english ? "Text" : "文字", exact: true })
          .click();
        await canvas.focus();
        await page.keyboard.press("Enter");
        await board
          .getByRole("textbox", { name: english ? "Text content" : "文字内容" })
          .fill("Draft");
        await expect(save).toBeDisabled();
        await board
          .getByRole("button", {
            name: english ? "Cancel text" : "取消文字",
            exact: true,
          })
          .click();
        await expect(save).toBeEnabled();
        await board
          .getByRole("button", {
            name: english ? "Use sketch" : "使用草图",
            exact: true,
          })
          .click();
        await expect(board).toBeHidden();
        await expect(page.locator(".pm-bar-thumb img")).toHaveCount(1);
      });

      test("导出失败可重试，清空后禁止保存", async ({ page }) => {
        const board = await openBoard(page, english);
        const save = board.getByRole("button", {
          name: english ? "Save image" : "保存图片",
          exact: true,
        });
        const canvas = board.locator("canvas").first();
        const box = (await canvas.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(save).toBeEnabled();
        await page.evaluate(() => {
          const original = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (callback) {
            HTMLCanvasElement.prototype.toBlob = original;
            callback(null);
          };
        });
        await save.click();
        await expect(
          page.getByText(
            english
              ? "Couldn't export the sketch. Please try again."
              : "草图导出失败，请重试",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(board).toBeVisible();
        await expect(save).toBeEnabled();
        const retry = page.waitForEvent("download");
        await save.click();
        expect(await (await retry).failure()).toBeNull();
        await board
          .getByRole("button", {
            name: english ? "Clear" : "清空",
            exact: true,
          })
          .click();
        await expect(save).toBeDisabled();
      });
    });
  }
}
