/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import { MOCK, solidPng } from "./helpers.ts";

for (const locale of ["zh-CN", "en"]) {
  for (const width of [1280, 390]) {
    test.describe(`background viewing ${locale} ${width}px`, () => {
      test.use({ locale, viewport: { width, height: 844 } });
      test("completed works stay accessible while independent tasks finish or fail", async ({
        page,
      }, testInfo) => {
        const en = locale === "en";
        const portrait = solidPng(360, 640).toString("base64");
        const landscape = solidPng(640, 360).toString("base64");
        await page.addInitScript(
          ({ baseUrl, locale }) => {
            localStorage.setItem(
              "PicMake-settings",
              JSON.stringify({
                state: {
                  baseUrl,
                  apiKey: "mock-key",
                  locale,
                  streamEnabled: false,
                },
                version: 0,
              }),
            );
          },
          { baseUrl: MOCK, locale },
        );
        await page.goto("/");
        await page.evaluate(
          async ({ portrait, landscape }) => {
            const modulePath = "/src/db/schema.ts";
            const { db } = await import(modulePath);
            const images = [
              { id: "portrait-image", data: portrait, width: 360, height: 640 },
              {
                id: "landscape-image",
                data: landscape,
                width: 640,
                height: 360,
              },
            ];
            await db.images.bulkPut(
              images.map(({ data, ...image }) => ({
                ...image,
                blob: new Blob(
                  [Uint8Array.from(atob(data), (char) => char.charCodeAt(0))],
                  { type: "image/png" },
                ),
                format: "png",
              })),
            );
            const params = {
              model: "flare",
              quality: "high",
              n: 1,
              size: "auto",
              background: "auto",
              outputFormat: "png",
            };
            await db.history.bulkPut(
              [
                {
                  id: "portrait",
                  prompt: "portrait 9:16",
                  imageIds: ["portrait-image"],
                },
                {
                  id: "landscape",
                  prompt: "landscape 16:9",
                  imageIds: ["landscape-image"],
                },
                {
                  id: "pair",
                  prompt: "two completed images",
                  imageIds: ["portrait-image", "landscape-image"],
                },
              ].map((row, index) => ({
                ...row,
                params: {
                  ...params,
                  prompt: row.prompt,
                  n: row.imageIds.length,
                },
                usage: null,
                createdAt: Date.now() - index,
                durationMs: 100,
              })),
            );
          },
          { portrait, landscape },
        );
        const releases: Array<() => void> = [];
        const finished = [false, false];
        await page.route("**/images/generations", async (route) => {
          const index = releases.length;
          await new Promise<void>((resolve) => releases.push(resolve));
          try {
            await route.fulfill(
              index === 0
                ? { status: 200, json: { data: [{ b64_json: portrait }] } }
                : {
                    status: 429,
                    json: { error: { message: "Mock background rate limit" } },
                  },
            );
          } catch {
            // The page may close during failure cleanup.
          } finally {
            finished[index] = true;
          }
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const gallery = page.locator(".pm-gal");
        const stage = page.locator(".pm-stage");
        const lightbox = page.getByRole("dialog", {
          name: en ? "Full-size image" : "查看大图",
          exact: true,
        });
        const newButton = page
          .getByRole("navigation")
          .getByRole("button", { name: en ? "Home" : "首页" });
        const prompt = page.getByRole("textbox", {
          name: en ? "Prompt" : "画面描述",
          exact: true,
        });
        const closePreview = () =>
          lightbox
            .getByRole("button", {
              name: en ? "Close full-size image" : "关闭大图",
              exact: true,
            })
            .click();
        const fit = async (ratio: number) => {
          const img = lightbox.locator("img.pm-lb-im");
          await expect(img).toBeVisible();
          await expect
            .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
            .toBeGreaterThan(0);
          const box = (await img.boundingBox())!;
          expect(box.width / box.height).toBeCloseTo(ratio, 2);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y + box.height).toBeLessThanOrEqual(844);
          expect(
            await img.evaluate((el) => getComputedStyle(el).objectFit),
          ).toBe("contain");
          const actions = (await lightbox
            .locator(".pm-lb-actions")
            .boundingBox())!;
          expect(actions.y + actions.height).toBeLessThanOrEqual(844);
        };
        try {
          await page
            .getByRole("button", {
              name: en ? "Expand and generate" : "展开并生成",
            })
            .click();
          for (const description of [
            "background succeeds",
            "background fails",
          ]) {
            await prompt.fill(description);
            await page
              .getByRole("button", {
                name: en ? "Generate image" : "生成图片",
                exact: true,
              })
              .click();
          }
          await expect.poll(() => releases.length).toBe(2);
          await prompt.fill("next draft stays intact");
          const portraitCard = gallery.getByRole("button", {
            name: /portrait 9:16/,
          });
          await portraitCard.focus();
          await page.keyboard.press("Enter");
          await expect(stage).toHaveAttribute("data-mode", "single");
          if (width < 760) await page.locator(".pm-detail-toggle").click();
          await expect(page.locator(".pm-detail")).toContainText(
            "portrait 9:16",
          );
          await page
            .locator(".pm-detail")
            .getByRole("button", { name: en ? "Hide details" : "收起详情" })
            .click();
          await stage.locator(".pm-single img").focus();
          await page.keyboard.press("Enter");
          await fit(9 / 16);
          releases[0]();
          await expect
            .poll(async () =>
              page.evaluate(async () => {
                const path = "/src/db/schema.ts";
                const { db } = await import(path);
                return (await db.history.toArray()).some(
                  (row: { prompt: string }) =>
                    row.prompt === "background succeeds",
                );
              }),
            )
            .toBe(true);
          await expect(lightbox.locator("img")).toHaveAttribute(
            "alt",
            "portrait 9:16",
          );
          await fit(9 / 16);
          await page.screenshot({
            path: testInfo.outputPath("portrait-background.png"),
          });
          await closePreview();
          await newButton.click();
          await expect(gallery.locator(".is-gen")).toHaveCount(1);
          await expect(prompt).toHaveValue("next draft stays intact");
          await gallery.getByRole("button", { name: /landscape 16:9/ }).click();
          await stage.locator(".pm-single img").click();
          await fit(16 / 9);
          await closePreview();
          await page
            .getByRole("navigation")
            .getByRole("button", { name: en ? "History" : "历史", exact: true })
            .click();
          await page
            .getByRole("dialog", {
              name: en ? "Generation history" : "生成历史",
            })
            .getByText("two completed images", { exact: true })
            .click();
          await stage.locator(".pm-gtile").first().click();
          const carousel = page.getByRole("dialog", {
            name: en ? "View images" : "查看图片",
            exact: true,
          });
          await expect(carousel).toBeVisible();
          await carousel
            .getByRole("button", { name: en ? "Next" : "下一张", exact: true })
            .click();
          await expect(carousel.locator("figcaption")).toContainText("2 / 2");
          releases[1]();
          await expect(
            page.getByText("Mock background rate limit", { exact: false }),
          ).toBeVisible();
          await expect(carousel.locator("figcaption")).toContainText("2 / 2");
          await expect(carousel.locator("img")).toHaveAttribute(
            "alt",
            "two completed images",
          );
          await expect(prompt).toHaveValue("next draft stays intact");
          expect(errors).toEqual([]);
          if (en)
            expect(await page.locator("body").innerText()).not.toMatch(
              /[\u3400-\u9fff]/u,
            );
        } finally {
          releases.forEach((release) => release());
          await expect
            .poll(() => finished.slice(0, releases.length).every(Boolean))
            .toBe(true);
        }
      });
    });
  }
}
