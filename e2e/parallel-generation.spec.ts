import { expect, test } from "@playwright/test";
import { MOCK } from "./helpers.ts";

for (const locale of ["zh-CN", "en"]) {
  for (const width of [1280, 390]) {
    test.describe(`parallel ${locale} ${width}px`, () => {
      test.use({ locale, viewport: { width, height: 900 } });
      for (const streaming of [true, false]) {
        test(`independent tasks, keyboard cancellation, and completion (${streaming ? "stream" : "JSON"})`, async ({
          page,
        }, testInfo) => {
          const en = locale === "en";
          await page.addInitScript(
            ({ baseUrl, locale, streamEnabled }) => {
              localStorage.setItem(
                "PicMake-settings",
                JSON.stringify({
                  state: { baseUrl, apiKey: "mock-key", locale, streamEnabled },
                  version: 0,
                }),
              );
            },
            { baseUrl: MOCK, locale, streamEnabled: streaming },
          );
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          const prompts: string[] = [];
          const releaseRequests: Array<() => void> = [];
          await page.route("**/images/generations", async (route) => {
            const description = route.request().postDataJSON().prompt as string;
            if (!description.startsWith("third"))
              await new Promise<void>((resolve) =>
                releaseRequests.push(resolve),
              );
            try {
              await route.continue();
            } catch {
              /* Cancelled fetch or closed page. */
            }
          });
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              request.url().endsWith("/images/generations")
            )
              prompts.push(request.postDataJSON().prompt);
          });
          await page.goto("/");
          await page
            .getByRole("button", {
              name: en ? "Expand and generate" : "展开并生成",
            })
            .click();
          const prompt = page.getByRole("textbox", {
            name: en ? "Prompt" : "画面描述",
            exact: true,
          });
          const send = page.getByRole("button", {
            name: en ? "Generate image" : "生成图片",
            exact: true,
          });
          const cards = page.locator(".pm-gal-card.is-gen");
          const first =
            "first task with a long description to check card wrapping [slow]";
          const second = "second task [slow]";
          await prompt.fill(first);
          await send.click();
          await expect(prompt).toHaveValue("");
          await prompt.fill(second);
          await send.click();
          await expect(prompt).toHaveValue("");
          await expect.poll(() => prompts.length).toBe(2);
          await expect(cards).toHaveCount(2);
          await expect(
            page.getByText(
              en ? "2 tasks generating in parallel" : "2 个任务同时生成中",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(send).toBeEnabled();
          await prompt.fill("");
          await expect(send).toBeDisabled();
          expect(
            await page
              .locator(".pm-bar")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
          expect(
            await page
              .locator(".pm-gal")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
          if (en)
            expect(await page.locator("body").innerText()).not.toMatch(
              /[\u3400-\u9fff]/u,
            );
          await page.screenshot({ path: testInfo.outputPath("parallel.png") });
          const firstCancel = cards
            .filter({ hasText: first })
            .getByRole("button");
          await firstCancel.focus();
          await page.keyboard.press("Enter");
          await expect(cards).toHaveCount(1);
          await expect(cards).toContainText(second);
          // Finishing a third task must leave the second request running.
          await prompt.fill("third task finishes first");
          await send.click();
          await expect(prompt).toHaveValue("");
          await expect.poll(() => prompts.length).toBe(3);
          await expect(
            page
              .locator(".pm-gal")
              .getByRole("button", { name: /third task finishes first/ }),
          ).toBeVisible();
          await expect(cards).toHaveCount(1);
          await expect(cards).toContainText(second);
          await prompt.fill("fourth task");
          await send.click();
          await expect(prompt).toHaveValue("");
          await expect(cards).toHaveCount(2);
          await page.locator(".pm-bar .pm-bar-cancel").click();
          await expect(cards).toHaveCount(0);
          await expect(page.locator(".pm-bar-gen")).toBeHidden();
          expect(prompts).toEqual([
            first,
            second,
            "third task finishes first",
            "fourth task",
          ]);
          expect(errors).toEqual([]);
          releaseRequests.forEach((release) => release());
        });
      }
    });
  }
}
