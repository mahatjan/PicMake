/** 参数映射、SSE 解析与模拟 fetch 的请求契约，不发网络请求。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createImageParser,
  editFormData,
  parseGenResponse,
  requestImages,
} from "./client";
import {
  ApiError,
  type EditSubmission,
  type ImageRequestResult,
} from "../lib/types";

const usage = {
  total_tokens: 600,
  input_tokens: 300,
  output_tokens: 300,
  input_tokens_details: { text_tokens: 100, image_tokens: 200 },
};
const params = {
  model: "flare",
  prompt: "添加一朵花",
  size: { w: 1024, h: 1024 },
  n: 2,
  quality: "high",
  background: "auto",
  outputFormat: "webp",
} as const;

const submission: EditSubmission = {
  sources: [
    {
      source: { generationId: "parent", imageId: "source" },
      image: {
        id: "source",
        blob: new Blob(["source"], { type: "image/jpeg" }),
        format: "jpeg",
        width: 1,
        height: 1,
      },
    },
  ],
  inputFidelity: "high",
};

afterEach(() => vi.unstubAllGlobals());

describe("流式配置的请求契约", () => {
  const inpaint: EditSubmission = {
    ...submission,
    inpaint: {
      maskImage: {
        id: "mask",
        blob: new Blob(["mask"], { type: "image/png" }),
        format: "png",
        width: 1,
        height: 1,
        mask: {
          version: 1,
          width: 1,
          height: 1,
          baseImageId: "source",
          commands: [],
        },
      },
    },
  };

  for (const streamEnabled of [undefined, true, false]) {
    for (const [kind, edit] of [
      ["生成", undefined],
      ["编辑", submission],
      ["局部重绘", inpaint],
    ] as const) {
      it(`${kind} streamEnabled=${streamEnabled}：只请求一次并解析完整 JSON`, async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            Response.json({ data: [{ b64_json: "final" }], usage }),
          );
        vi.stubGlobal("fetch", fetchMock);
        const onPartial = vi.fn();
        await expect(
          requestImages(
            params,
            { baseUrl: "https://api.example/v1", apiKey: "key", streamEnabled },
            { onPartial },
            edit,
          ),
        ).resolves.toEqual({ images: ["final"], usage });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
          `https://api.example/v1/images/${edit ? "edits" : "generations"}`,
        );
        const fields = edit
          ? Object.fromEntries((init.body as FormData).entries())
          : JSON.parse(init.body);
        if (streamEnabled === false) {
          expect(fields).not.toHaveProperty("stream");
          expect(fields).not.toHaveProperty("partial_images");
        } else {
          expect(String(fields.stream)).toBe("true");
          expect(String(fields.partial_images)).toBe("3");
        }
        if (edit) expect(fields.image).toBeInstanceOf(Blob);
        if (edit?.inpaint) expect(fields.mask).toBeInstanceOf(Blob);
        expect(onPartial).not.toHaveBeenCalled();
      });
    }
  }

  it.each([true, false])(
    "streamEnabled=%s：服务商拒绝请求时不自动重试",
    async (streamEnabled) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Unsupported parameter" } },
            { status: 400 },
          ),
        );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        requestImages(params, {
          baseUrl: "https://api.example",
          apiKey: "key",
          streamEnabled,
        }),
      ).rejects.toMatchObject({
        message: "Unsupported parameter",
        status: 400,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("编辑请求映射", () => {
  it("multipart 保留来源格式、保真度和生成参数", () => {
    const body = editFormData(submission, params);
    expect(body.get("image")).toBeInstanceOf(Blob);
    expect((body.get("image") as File).name).toBe("source.jpg");
    expect((body.get("image") as File).type).toBe("image/jpeg");
    expect(
      Object.fromEntries(
        [...body.entries()].filter(([key]) => key !== "image"),
      ),
    ).toEqual({
      model: "gpt-image-2.5-flare",
      prompt: "添加一朵花",
      n: "2",
      size: "1024x1024",
      quality: "high",
      background: "auto",
      output_format: "webp",
      input_fidelity: "high",
      stream: "true",
      partial_images: "3",
    });
  });
  it("auto 档不发送 input_fidelity（部分中转不支持该参数）", () => {
    const body = editFormData({ ...submission, inputFidelity: "auto" }, params);
    expect(body.get("input_fidelity")).toBeNull();
  });
  it("多图按输入顺序使用 image[]", async () => {
    const multi: EditSubmission = {
      ...submission,
      sources: [
        ...submission.sources,
        {
          source: { imageId: "second" },
          image: {
            id: "second",
            blob: new Blob(["second"], { type: "image/png" }),
            format: "png",
            width: 1,
            height: 1,
          },
        },
      ],
    };
    const body = editFormData(multi, params);
    expect(body.has("image")).toBe(false);
    const images = body.getAll("image[]") as File[];
    expect(images.map((file) => file.type)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(await Promise.all(images.map((file) => file.text()))).toEqual([
      "source",
      "second",
    ]);
    expect(body.get("n")).toBe("2");
  });
});

describe("请求级 usage", () => {
  it("多图 JSON 只保留一份根级 usage", () => {
    const result = parseGenResponse({
      data: [{ b64_json: "a" }, { b64_json: "b" }],
      usage,
    });
    expect(result.images).toEqual(["a", "b"]);
    expect(result.usage).toEqual(usage);
  });
  it("拒绝空结果及没有图片的响应", () => {
    expect(() => parseGenResponse({ data: [] })).toThrow();
    expect(() => parseGenResponse({ data: [{}] })).toThrow();
  });
});

describe("只给 URL 的中转（object 事件名 + data[].url）", () => {
  const url = "https://imgv1.example.com/images/a.png";

  it("image.generation.result 的 url 被收集，不再当成没有图片", () => {
    const result: ImageRequestResult = { images: [], usage: null };
    const urls: string[] = [];
    const parser = createImageParser({}, result, urls);
    parser.feed(
      [
        `data: ${JSON.stringify({ object: "image.generation.chunk", index: 1, total: 1, progress_text: "", data: [] })}\n\n`,
        `data: ${JSON.stringify({ object: "image.generation.chunk", upstream_event_type: "title_generation", data: [] })}\n\n`,
        `data: ${JSON.stringify({ object: "image.generation.result", index: 1, total: 1, data: [{ url, revised_prompt: "改写后的描述" }] })}\n\n`,
        "data: [DONE]\n\n",
      ].join(""),
    );
    expect(result.images).toEqual([]);
    expect(urls).toEqual([url]);
  });

  it("非流式响应里的 url 也被收集", () => {
    const parsed = parseGenResponse({ data: [{ url }], usage });
    expect(parsed.images).toEqual([]);
    expect(parsed.urls).toEqual([url]);
    expect(parsed.usage).toEqual(usage);
  });

  it("b64 与 url 混合时各自归位，两种事件命名都认", () => {
    const result: ImageRequestResult = { images: [], usage: null };
    const urls: string[] = [];
    const parser = createImageParser({}, result, urls);
    parser.feed(
      [
        `data: ${JSON.stringify({ type: "image_generation.completed", b64_json: "a", usage })}\n\n`,
        `data: ${JSON.stringify({ object: "image.generation.result", data: [{ url }] })}\n\n`,
        `event: image_edit.result\ndata: ${JSON.stringify({ b64_json: "b" })}\n\n`,
      ].join(""),
    );
    expect(result.images).toEqual(["a", "b"]);
    expect(urls).toEqual([url]);
    expect(result.usage).toEqual(usage);
  });

  it("既没有 b64 也没有 url 的结果仍然拦截", () => {
    expect(() => parseGenResponse({ data: [] })).toThrow();
    expect(() => parseGenResponse({ data: [{}] })).toThrow();
  });
});

describe("生成和编辑 SSE", () => {
  for (const endpoint of ["image_generation", "image_edit"]) {
    it(`${endpoint} 跨 chunk 预览、两张终稿和请求总量`, () => {
      const result: ImageRequestResult = { images: [], usage: null };
      const partials: string[] = [];
      const parser = createImageParser(
        { onPartial: (b64) => partials.push(b64) },
        result,
      );
      const stream = [
        `event: ${endpoint}.partial_image\ndata: ${JSON.stringify({ b64_json: "preview", partial_image_index: 1 })}\n\n`,
        `data: ${JSON.stringify({ type: `${endpoint}.completed`, b64_json: "first", usage })}\n\n`,
        `data: ${JSON.stringify({ type: `${endpoint}.completed`, b64_json: "second", usage })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      for (let i = 0; i < stream.length; i += 7)
        parser.feed(stream.slice(i, i + 7));
      expect(partials).toEqual(["preview"]);
      expect(result.images).toEqual(["first", "second"]);
      expect(result.usage).toEqual(usage);
    });
  }
  it("保留流内内容政策错误的类别", () => {
    const parser = createImageParser({}, { images: [], usage: null });
    expect(() =>
      parser.feed(
        'data: {"type":"error","code":"content_policy_violation","message":"policy"}\n\n',
      ),
    ).toThrow(ApiError);
  });
});
