/**
 * PicMake 开发用 mock API：模拟 OpenAI 兼容的图片接口，零依赖，只用于本地验证。
 *
 * 用法：pnpm mock，然后在设置里把 API 地址填为 http://localhost:8787（应用会自动补 /v1），Key 随便填。
 * 端口：环境变量 MOCK_PORT，默认 8787。返回按请求尺寸生成的纯色 PNG（auto 时 1024 × 1024）。
 *
 * 在画面描述里加标记触发不同场景：
 *   [401] [403] [429] [500]  对应的 HTTP 错误
 *   [policy]                  HTTP 400，code 为 content_policy_violation
 *   [stream-error]            第一个 partial 之后发 error 事件
 *   [slow]                    事件间隔 3 秒，便于测试取消
 *   [json]                    不走 SSE，直接返回 JSON（中转站兼容路径）
 *   [url]                     只在 data[] 里给图片 URL（部分中转不发 b64_json，客户端需下载）
 *
 * 多尺寸生成每个比例是一个独立请求，描述里的标记会让所有比例一起触发。
 * 只想让某个尺寸触发，在标记里加 @宽x高，例如 [429@1792x1008]、[slow@1792x1008]、[500@1008x1792]：
 * 只有请求尺寸恰好是 1792 × 1008 的那个请求报 429 / 放慢，其余照常，用来验证部分失败与取消时保留已完成的图。
 * 适用于全部标记：[401] [403] [429] [500] [policy] [stream-error] [slow] [json] [url]
 */
import http from "node:http";
import zlib from "node:zlib";

const PORT = Number(process.env.MOCK_PORT) || 8787;
const MAX_SIDE = 3840;
const GREY = [160, 160, 160];

const MODELS = [
  { id: "gpt-image-2.5", object: "model" },
  { id: "gpt-image-1", object: "model" },
];

/** 标记 → [HTTP 状态, error.code, error.message] */
const HTTP_ERRORS = {
  "[401]": [401, "invalid_api_key", "mock：API Key 无效"],
  "[403]": [403, "organization_not_verified", "mock：组织未完成验证"],
  "[429]": [429, "rate_limit_exceeded", "mock：请求过于频繁"],
  "[500]": [500, "server_error", "mock：服务端错误"],
  "[policy]": [400, "content_policy_violation", "mock：内容被拦截"],
};

/* ── PNG：纯色 RGB，按尺寸与颜色缓存 b64 ── */

const pngCache = new Map();

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
  return out;
}

function solidPng(width, height, [r, g, b]) {
  const key = `${width}x${height}:${r},${g},${b}`;
  const cached = pngCache.get(key);
  if (cached) return cached;
  // 每行：1 字节过滤类型（0）+ width 个 RGB 像素
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 真彩色 RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.alloc(row.length * height, row))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const b64 = png.toString("base64");
  pngCache.set(key, b64);
  return b64;
}

/** 描述里是否带有这个标记：[名字] 对所有请求生效，[名字@宽x高] 只对该尺寸的请求生效 */
function marked(prompt, name, width, height) {
  return (
    prompt.includes(`[${name}]`) ||
    prompt.includes(`[${name}@${width}x${height}]`)
  );
}

/** 同一描述、同一张序号得到稳定的颜色 */
function colorFor(prompt, index) {
  let h = 2166136261;
  for (const ch of `${prompt}|${index}`)
    h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return [64 + (h & 0x7f), 64 + ((h >>> 8) & 0x7f), 64 + ((h >>> 16) & 0x7f)];
}

/** partial 由灰色逐级过渡到终稿颜色 */
function mix(from, to, t) {
  return from.map((v, i) => Math.round(v + (to[i] - v) * t));
}

function parseSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(String(size ?? ""));
  if (!m) return [1024, 1024];
  const side = (v) => Math.min(Math.max(Number(v), 16), MAX_SIDE);
  return [side(m[1]), side(m[2])];
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(Math.max(Math.round(n), min), max)
    : fallback;
};

/* ── 请求解析 ── */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** 最小 multipart 解析：文本字段取值，文件只记名称 */
function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? "");
  const fields = {};
  const files = [];
  if (!boundary) return { fields, files };
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    pos += delimiter.length;
    if (body.subarray(pos, pos + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", pos);
    const next = headerEnd === -1 ? -1 : body.indexOf(delimiter, headerEnd);
    if (next === -1) break;
    const headers = body.subarray(pos, headerEnd).toString("utf8");
    const name = /name="([^"]*)"/.exec(headers)?.[1] ?? "";
    if (/filename="/.test(headers)) files.push(name);
    else fields[name] = body.subarray(headerEnd + 4, next - 2).toString("utf8");
    pos = next;
  }
  return { fields, files };
}

function toImageRequest(fields) {
  return {
    prompt: String(fields.prompt ?? ""),
    n: clamp(fields.n, 1, 4, 1),
    size: fields.size,
    partialImages: clamp(fields.partial_images, 0, 3, 0),
    stream: fields.stream === true || fields.stream === "true",
  };
}

/* ── 响应 ── */

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { message, type: "mock_error", code } });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 图片 URL：客户端拿到后要自己下载，路径里带尺寸与颜色便于直接重建 */
function imageUrl(base, width, height, [r, g, b]) {
  return `${base}/mock-image/${width}x${height}-${r}_${g}_${b}.png`;
}

async function handleImages(res, request, edit, base) {
  const { prompt, n, partialImages, stream } = request;
  const [width, height] = parseSize(request.size);
  const kind = edit ? "image_edit" : "image_generation";
  // [url]：终稿只给 URL（不发 b64_json），模拟不发 base64 的中转
  const urlOnly = marked(prompt, "url", width, height);

  for (const [marker, [status, code, message]] of Object.entries(HTTP_ERRORS)) {
    if (marked(prompt, marker.slice(1, -1), width, height))
      return sendError(res, status, code, message);
  }

  const usage = {
    input_tokens: 50,
    output_tokens: 1000 * n,
    total_tokens: 50 + 1000 * n,
  };
  // 颜色带上尺寸：多尺寸生成时每个请求 n = 1，不然各比例同色，看不出谁是谁
  const seed = `${prompt}|${width}x${height}`;
  const finals = Array.from({ length: n }, (_, i) =>
    solidPng(width, height, colorFor(seed, i)),
  );

  if (!stream || marked(prompt, "json", width, height)) {
    return sendJson(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: finals.map((b64_json, i) =>
        urlOnly
          ? {
              url: imageUrl(base, width, height, colorFor(seed, i)),
              revised_prompt: prompt,
            }
          : { b64_json },
      ),
      usage,
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const send = (type, payload) => {
    if (!closed)
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`,
      );
  };
  // [url] 用的就是部分中转那套命名：object + image.<kind>.result，事件体里没有 b64_json
  const sendRaw = (payload) => {
    if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const gap = marked(prompt, "slow", width, height) ? 3000 : 400;
  const meta = { size: `${width}x${height}`, output_format: "png" };

  for (let i = 0; i < n; i++) {
    const final = colorFor(seed, i);
    const streamError = marked(prompt, "stream-error", width, height);
    const partials = streamError ? 1 : partialImages;
    for (let k = 0; k < partials; k++) {
      await sleep(gap);
      if (closed) return;
      send(`${kind}.partial_image`, {
        b64_json: solidPng(
          width,
          height,
          mix(GREY, final, (k + 1) / (partials + 1)),
        ),
        partial_image_index: k,
        ...meta,
      });
    }
    if (streamError) {
      send("error", {
        error: { status: 500, code: "server_error", message: "mock：生成中断" },
      });
      res.end();
      return;
    }
    await sleep(gap);
    if (closed) return;
    if (urlOnly) {
      sendRaw({
        object: `${kind.replace("_", ".")}.result`,
        index: i + 1,
        total: n,
        data: [{ url: imageUrl(base, width, height, final) }],
      });
    } else {
      send(`${kind}.completed`, { b64_json: finals[i], ...meta, usage });
    }
  }
  res.end();
}

/* ── 服务 ── */

function log(edit, request, files) {
  const [width, height] = parseSize(request.size);
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const inputs = edit
    ? ` 输入 ${files.filter((f) => f !== "mask").length} 张${files.includes("mask") ? " + mask" : ""}`
    : "";
  console.log(
    `${time} ${edit ? "编辑" : "生成"} n=${request.n} ${width}x${height}${inputs}「${request.prompt.slice(0, 40)}」`,
  );
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && pathname === "/v1/models") {
      sendJson(res, 200, { object: "list", data: MODELS });
      return;
    }
    // [url] 标记指向的图片：客户端下载后转 base64
    const image = /^\/mock-image\/(\d+)x(\d+)-(\d+)_(\d+)_(\d+)\.png$/.exec(
      pathname,
    );
    if (req.method === "GET" && image) {
      const [, w, h, r, g, b] = image;
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": Buffer.from(
          solidPng(Number(w), Number(h), [Number(r), Number(g), Number(b)]),
          "base64",
        ).length,
      });
      res.end(
        Buffer.from(
          solidPng(Number(w), Number(h), [Number(r), Number(g), Number(b)]),
          "base64",
        ),
      );
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/v1/images/generations" || pathname === "/v1/images/edits")
    ) {
      const edit = pathname.endsWith("/edits");
      const body = await readBody(req);
      const { fields, files } = edit
        ? parseMultipart(body, req.headers["content-type"])
        : { fields: JSON.parse(body.toString("utf8") || "{}"), files: [] };
      const request = toImageRequest(fields);
      log(edit, request, files);
      await handleImages(
        res,
        request,
        edit,
        `http://${req.headers.host ?? `localhost:${PORT}`}`,
      );
      return;
    }
    sendError(res, 404, "not_found", `mock：未实现 ${req.method} ${pathname}`);
  } catch (error) {
    if (res.headersSent) res.end();
    else sendError(res, 500, "server_error", `mock：${error.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`PicMake mock API 已启动：http://localhost:${PORT}`);
  console.log(
    "在设置里把 API 地址填为上面的地址（会自动补 /v1），Key 随便填。",
  );
  console.log(
    "描述里的标记：[401] [403] [429] [500] [policy] [stream-error] [slow] [json] [url]",
  );
  console.log("只对某个尺寸生效：加 @宽x高，如 [429@1792x1008]");
});
