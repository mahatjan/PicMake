/// <reference lib="dom" />
// page.evaluate 的回调在浏览器里执行，用到 document 的类型
import { expect, test, type Page } from "@playwright/test";
import { MOCK, solidPng } from "./helpers.ts";

// 国际化冒烟：英文界面、系统语言解析、设置里切换。中文界面由 smoke.spec.ts 覆盖。

/** 汉字、日文假名、中日韩标点与全角字符 */
const CJK = /[　-ヿ㐀-䶿一-鿿＀-￯]/;

/** 页面上用户能看到或读到的全部文字：可见文本 + 无障碍名称、提示、占位符、图片替代文字 */
async function pageTexts(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const el of document.querySelectorAll(
      "[aria-label],[title],[placeholder],[alt]",
    )) {
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
        const value = el.getAttribute(attr);
        if (value) parts.push(value);
      }
    }
    return parts.join("\n");
  });
}

/** 断言没有残留中文。语言名「简体中文」是各语言自称，按设计保持原样；用户自己输入的内容这里都是英文 */
async function expectNoCjk(page: Page) {
  const text = (await pageTexts(page)).replace(/简体中文/g, "");
  expect(text.match(CJK)?.[0] ?? "", "界面里还有未翻译的中文").toBe("");
}

const prompt = (page: Page) => page.getByRole("textbox", { name: "Prompt" });

async function configure(page: Page, baseUrl = MOCK) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("API URL").fill(baseUrl);
  await dialog.getByLabel("API Key", { exact: true }).fill("mock-key");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

async function expandBar(page: Page) {
  await page.getByRole("button", { name: "Expand and generate" }).click();
  await expect(prompt(page)).toBeVisible();
}

test.describe("英文界面", () => {
  test.use({ locale: "en-US" });

  test("首次进入即英文：配置、生成、历史、详情都没有残留中文", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(
      dialog.getByRole("heading", { name: "Connect your API" }),
    ).toBeVisible();
    await expectNoCjk(page);

    await configure(page);
    await expect(page.getByText("Settings saved")).toBeVisible();
    await expect(page.getByText("Start with a sentence")).toBeVisible();
    await expectNoCjk(page);

    await expandBar(page);
    await prompt(page).fill("a small cabin on a snowy mountaintop");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(
      page.getByText("Generation complete · saved locally"),
    ).toBeVisible();
    // 详情浮卡、底栏完成态、创作条都在页面上
    await expect(page.getByLabel("Details of this generation")).toBeVisible();
    await expectNoCjk(page);

    await page.getByRole("button", { name: "History" }).click();
    const drawer = page.getByRole("dialog", { name: "Generation history" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("1 image")).toBeVisible();
    await drawer.getByLabel("Search history prompts").fill("zzz");
    await expect(drawer.getByText("No matching history")).toBeVisible();
    await expectNoCjk(page);
  });

  test("无法连接 API：客户端细节按英文显示", async ({ page }) => {
    await configure(page, "http://localhost:1");
    await expandBar(page);
    await prompt(page).fill("unreachable server");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(
      page.getByText("Can't reach the API URL: Can't reach the API URL"),
    ).toBeVisible();
    await expectNoCjk(page);
  });

  test("多张结果：网格、轮播与删除确认（含复数）", async ({ page }) => {
    await configure(page);
    await expandBar(page);
    await page.getByRole("button", { name: "Number of images" }).click();
    await page.getByRole("button", { name: "×2" }).click();
    // [json]：mock 直接回 JSON、不走慢速流，多张结果也能很快出来
    await prompt(page).fill("two pictures [json]");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(
      page.getByText("Generation complete · saved locally"),
    ).toBeVisible();
    await expect(page.getByText("2 images")).toBeVisible();
    await expectNoCjk(page);

    await page.getByRole("button", { name: "Result 1" }).click();
    const carousel = page.getByRole("dialog", { name: "View images" });
    await expect(carousel).toBeVisible();
    await expectNoCjk(page);
    await carousel.getByRole("button", { name: "Close carousel" }).click();

    await page.getByRole("button", { name: "Delete this generation" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete this generation?",
    });
    await expect(
      confirm.getByText("It contains 2 images. This can't be undone."),
    ).toBeVisible();
    await expectNoCjk(page);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
  });

  test("草图画板与局部重绘弹层没有残留中文", async ({ page }) => {
    await configure(page);
    await expandBar(page);

    await page.getByRole("button", { name: "Add input" }).click();
    await page.getByRole("button", { name: /Draw a sketch/ }).click();
    const sketch = page.getByRole("dialog", { name: "Sketch board" });
    await expect(sketch).toBeVisible();
    // 新画布取当前输出尺寸（默认 3:2 → 1536 × 1024）
    await expect(sketch.getByText("1536 × 1024")).toBeVisible();
    await expectNoCjk(page);
    await sketch.getByRole("button", { name: "Close board" }).click();
    await expect(sketch).toBeHidden();

    await page.locator('input[type="file"]').setInputFiles({
      name: "base.png",
      mimeType: "image/png",
      buffer: solidPng(256, 256),
    });
    await page.getByRole("button", { name: "Inpaint Image 1" }).click();
    const board = page.getByRole("dialog", {
      name: "Select the area to change",
    });
    await expect(board).toBeVisible();
    await expectNoCjk(page);
    const box = (await board.locator("canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, {
      steps: 6,
    });
    await page.mouse.up();
    await board.getByRole("button", { name: "Use selection" }).click();
    await expect(board).toBeHidden();

    // 创作条的重绘态：来源名按英文显示，提示与说明都是英文
    await expect(
      page.getByRole("button", { name: "Remove selection" }),
    ).toBeVisible();
    await expectNoCjk(page);
    await page
      .getByRole("textbox", { name: "Edit prompt" })
      .fill("make the middle red");
    await page.getByRole("button", { name: "Generate inpaint result" }).click();
    await expect(
      page.getByText("Generation complete · saved locally"),
    ).toBeVisible();
    await page.getByRole("button", { name: "View selection" }).click();
    const view = page.getByRole("dialog", { name: "View selection" });
    await expect(view.getByText("Base image · 256 × 256")).toBeVisible();
    await expectNoCjk(page);
  });

  /** 比例弹层、创作条一行 chip、详情浮卡里有没有内容被挤出容器（英文比中文长 30%–50%） */
  async function overflowing(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".pm-pop, .pm-bar-row2, .pm-detail, .pm-mcell, .pm-gen-pill",
        ),
      ]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className),
    );
  }

  test("多比例：弹层、生成结果与部分失败提示没有残留中文，也不溢出", async ({
    page,
  }) => {
    await configure(page);
    await expandBar(page);
    await page
      .getByRole("button", { name: "Ratio and base resolution" })
      .click();
    const pop = page.getByRole("dialog", { name: "Ratio and base resolution" });
    await pop.getByRole("switch", { name: "Multiple ratios" }).click();
    for (const id of ["16:9", "9:16", "1:1"])
      await pop.getByRole("button", { name: id, exact: true }).click();
    // 开启时默认选中的 3:2 最后取消（至少保留 1 个）
    await pop.getByRole("button", { name: "3:2", exact: true }).click();
    await expect(
      pop.getByText("Each ratio is a separate, billed request"),
    ).toBeVisible();
    await expect(
      pop.getByText(
        "Each ratio is composed on its own, so the images won't match",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Ratio and base resolution" }),
    ).toContainText("3 ratios · 1K");
    await expect(
      page.getByRole("button", { name: "Number of images" }),
    ).toBeDisabled();
    await expectNoCjk(page);
    expect(await overflowing(page)).toEqual([]);

    // 再选满 4 个：提示与禁用态
    await pop.getByRole("button", { name: "4:3", exact: true }).click();
    await expect(pop.getByText("Up to 4 ratios")).toBeVisible();
    await expect(pop.getByRole("button", { name: "Auto" })).toBeDisabled();
    await expectNoCjk(page);
    expect(await overflowing(page)).toEqual([]);
    await pop.getByRole("button", { name: "4:3", exact: true }).click();
    await page.mouse.click(40, 420);

    await prompt(page).fill("three ratios [json] [429@1008x1792]");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(page.getByText("2 of 3 sizes generated")).toBeVisible();
    await expect(page.getByText("9:16: Too many requests")).toBeVisible();
    await expect(page.getByText("2 sizes")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Regenerate · 3 sizes" }),
    ).toBeVisible();
    await expect(page.getByText("Not generated: 9:16")).toBeVisible();
    await expect(page.locator(".pm-mcap")).toHaveText([
      "1:1 · 1024 × 1024",
      "16:9 · 1792 × 1008",
    ]);
    await expectNoCjk(page);
    expect(await overflowing(page)).toEqual([]);

    await page.getByRole("button", { name: "Result 1" }).click();
    const carousel = page.getByRole("dialog", { name: "View images" });
    await expect(carousel.getByText("1:1 · 1024 × 1024")).toBeVisible();
    await expectNoCjk(page);
  });

  test("多比例：生成中的进度、失败格与取消提示（含复数）", async ({ page }) => {
    await configure(page);
    await expandBar(page);
    await page
      .getByRole("button", { name: "Ratio and base resolution" })
      .click();
    const pop = page.getByRole("dialog", { name: "Ratio and base resolution" });
    await pop.getByRole("switch", { name: "Multiple ratios" }).click();
    for (const id of ["1:1", "16:9", "9:16"])
      await pop.getByRole("button", { name: id, exact: true }).click();
    await pop.getByRole("button", { name: "3:2", exact: true }).click();
    await page.mouse.click(40, 420);

    await prompt(page).fill("cancel one [500@1008x1792] [slow@1792x1008]");
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(page.getByText("Generating · 1/3 done")).toBeVisible();
    await expect(page.getByText("Failed", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Service temporarily unavailable"),
    ).toBeVisible();
    await expectNoCjk(page);
    expect(await overflowing(page)).toEqual([]);
    await page.getByRole("button", { name: "Cancel generation" }).click();
    // 1 张已完成：复数的 _one 形式
    await expect(
      page.getByText("Cancelled. 1 finished image saved"),
    ).toBeVisible();
    await expectNoCjk(page);
  });
});

test.describe("系统语言", () => {
  test.describe("繁体中文", () => {
    test.use({ locale: "zh-TW" });
    test("按简体中文显示", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    });
  });

  test.describe("不支持的语言", () => {
    test.use({ locale: "fr-FR" });
    test("回落到英文", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        page.getByRole("dialog", { name: "Settings" }),
      ).toBeVisible();
    });
  });
});

test.describe("设置里切换语言", () => {
  test.use({ locale: "en-US" });

  test("即时生效、刷新后保持，选回跟随系统恢复", async ({ page }) => {
    await configure(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Settings" });
    const language = dialog.getByRole("group", { name: "Language" });
    await expect(
      language.getByRole("button", { name: "Follow system" }),
    ).toHaveAttribute("aria-pressed", "true");
    await language.getByRole("button", { name: "简体中文" }).click();

    // 即时切换：弹窗本身、页面语言属性与顶栏都变成中文
    dialog = page.getByRole("dialog", { name: "设置" });
    await expect(
      dialog.getByRole("heading", { name: "连接你的 API" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("button", { name: "历史" })).toBeVisible();

    // 偏好存在 localStorage：刷新后仍是中文
    await page.reload();
    await expect(page.getByRole("button", { name: "历史" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    // 选回「跟随系统」：浏览器是英文，界面回到英文
    await page.getByRole("button", { name: "设置", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "设置" });
    await dialog
      .getByRole("group", { name: "语言" })
      .getByRole("button", { name: "跟随系统" })
      .click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
