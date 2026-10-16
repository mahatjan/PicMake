# AGENTS.md

本仓库（PicMake）对 AI agent 的协作约定。修改前读完本文，并按任务阅读相关文档与现有实现。

## 0. 权威源与阅读范围

| 文档                                                     | 作用                                                        | 何时阅读                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| [docs/prd.md](./docs/prd.md)                             | **需求唯一基准**（FR-1~10、状态机、验收标准、视觉规范）     | 修改用户可感知的行为、状态、样式或数据边界                 |
| [docs/demos/prototype.html](./docs/demos/prototype.html) | **交互对照唯一基准**（V2 结果舞台版，含打开状态机与全场景） | 修改界面与交互                                             |
| [docs/gpt-image-2.5-api.md](./docs/gpt-image-2.5-api.md) | API 参考（参数枚举、流式事件、定价、兼容性）                | 修改请求、响应解析与错误处理；产品传输策略以 PRD FR-4 为准 |
| [docs/tech-stack.md](./docs/tech-stack.md)               | 技术栈定稿 + 实测坑记录                                     | 修改架构、依赖、框架配置或库的使用方式                     |

文档描述预期行为，代码用于确认当前行为。发现两者冲突时明确指出，不把现有实现自动当成正确需求。`docs/` 是不随公开仓库发布的内部文档；缺失时说明验证范围，不编造其内容。

## 1. 常用命令

```bash
pnpm dev            # 开发服务器（5173）
pnpm build          # tsc -b && vite build
pnpm lint           # oxlint（本项目不用 ESLint）
pnpm test           # vitest run（node 环境：lib 纯函数、store 迁移函数与 selector）
pnpm e2e            # Playwright 冒烟（专用端口 5273 / 8788，自带 mock；首次需 `pnpm exec playwright install chromium`）
pnpm check          # lint + prettier --check + check:i18n + test + build（CI 同款）
pnpm check:i18n     # 扫描 src，发现写死的中文界面文案就报错（见 §3.4 第 6 条）
pnpm mock           # 本地 mock API（8787）：设置里 API 地址填 http://localhost:8787；描述里的 [401] [429] [slow] 等标记触发错误与慢速流，见 README
pnpm exec prettier --write <本次修改的文件>
```

## 2. 技术栈事实（不要凭记忆假设）

- **纯前端 SPA**：Vite 8 + React 19 + TypeScript 6。无后端、无路由（MVP 单页 + 弹层）
- **TS 开启 `erasableSyntaxOnly`**：禁止构造器参数属性、禁止 enum 声明
- **Tailwind CSS v4**：走 `@tailwindcss/vite` 插件，**没有 tailwind.config**；CSS 入口 `src/index.css`（`@import 'tailwindcss'` + HeroUI 样式**按组件引入**，不整包 `@import '@heroui/styles'`；用到新的 HeroUI 组件时须在 `index.css` 补对应的 `components/<name>.css`）；设计令牌 `--pm-*` 定义在 `:root`，勿在组件里写死色值
- **HeroUI v3**（`@heroui/react`）：
  - `Button` **没有 color prop**，用 `variant`（primary/secondary/tertiary/ghost/outline/danger/danger-soft）+ `size`（sm/md/lg）+ `fullWidth/isIconOnly/isDisabled`
  - `Chip` 用 `color`（accent/default/success/warning/danger）+ `variant`（primary/secondary/soft）
  - 无需全局 Provider；react-aria 系 peers 已显式安装，升级时勿移除
  - `toast()` 只负责入队，靠 `src/main.tsx` 里挂载的 `<Toast.Provider />` 显示，勿删
- **状态**：Zustand。`src/store/settings.ts` 持久化到 localStorage（key `PicMake-settings`）；`src/store/workspace/` 是工作区会话状态（历史列表、草稿、生成、画板、查看状态），**不持久化**，分层与写法见 §3
- **国际化**：i18next + react-i18next，支持简体中文（`zh-CN`，源语言）与英文（`en`）。资源在 `src/i18n/resources/`：`zh-CN.ts` 是文案 key 的唯一来源，`en.ts` 用 `satisfies LocaleResource` 与它保持同构（缺 key、多 key 编译失败），插值变量与复数成对由 `resources.test.ts` 校验。资源随包内置、同步初始化，首帧即是正确语言。语言偏好存 `PicMake-settings.locale`（`system`/`zh-CN`/`en`，默认跟随浏览器），解析规则在 `src/lib/locale.ts`。**不用**语言检测与后端加载插件：前者会往 localStorage 写 `i18nextLng`，违反 §5 持久化只有两处。新增语言：补一份同构资源，加进 `resources/index.ts` 与 `lib/locale.ts` 的 `LOCALES`
- **存储**：Dexie（`src/db/schema.ts`），IndexedDB 库名 `PicMake`，表 `images`（Blob）/ `history`（元信息）
- **网络**：一律走 `src/api/client.ts`（原生 fetch 封装：`/v1` 归一化、错误归一化、单次流式请求——无自动降级/重试，见 PRD FR-4）。**不用** openai SDK / axios
- **流式解析**：eventsource-parser **v4**，API 是 `createParser({ onEvent })` 配置对象（不是回调参数）；`EventSource` 不支持 POST 不可用
- **包管理**：pnpm；`.npmrc` `save-prefix=~`（锁 minor）

## 3. 架构与状态边界

### 3.1 分层

```
containers/ ──► components/              展示组件
     │
     ├──► hooks/ ───────┐                Object URL、图片资源读取、DOM 监听、matchMedia
     │                  ▼
     ├──► store/workspace ──► lib/       状态 + 迁移函数 + selector；lib 是纯函数
     │        ▲
     └──► flows/ ───────┘
              │
              └──► api/ · db/ · toast

i18n/ ──► lib/                           文案资源与「码 → 当前语言文案」；被 components、containers、flows、hooks 引用
```

箭头表示"引用"。flows、hooks、containers 也可以直接引用 lib。

| 层         | 目录                   | 可以                                                                                                          | 不可以                                                               |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| components | `src/components/`      | 接收 props，管理自身的交互状态（弹层开合、焦点、行内草稿）；用 `useTranslation` 与 `i18n/` 的拼装函数生成文案 | 引用 store、flows、hooks、containers、api、db                        |
| containers | `src/containers/`      | 用 selector 读 store；调用 hooks、flows、迁移函数，投影成 props                                               | 写业务规则；直接 `setState`；调用 api、db                            |
| flows      | `src/flows/`           | 调用 api、db、toast；`getState()`；调用迁移函数；用 `i18n` 的 `t` 生成 toast 与确认框文案                     | 持有 React 状态；创建 Object URL；引用 hooks、containers、components |
| store      | `src/store/workspace/` | 定义状态、迁移函数、selector                                                                                  | IO、toast、Object URL、React API、界面文案（引用 `i18n`）            |
| hooks      | `src/hooks/`           | 管理绑定 React 生命周期的资源                                                                                 | 互相注入；写业务规则；引用 api、flows、containers、components        |
| lib        | `src/lib/`             | 纯函数和类型，业务规则的唯一实现；返回问题码与结构化数据                                                      | 引用以上任何一层，引用 `i18n`（lib 不产出界面文案）                  |
| i18n       | `src/i18n/`            | i18next 实例、翻译资源、依赖语言的格式化与「码 → 文案」拼装                                                   | 引用 lib 以外的任何一层                                              |

- 以上"引用"指运行时引用，`import type` 放行。越层引用由 `.oxlintrc.json` 的 `no-restricted-imports` 按目录检查；"容器不写业务规则、不直接 `setState`"靠评审。
- `src/App.tsx` 只做组合：启动历史订阅、算一次图片资源、渲染各区域容器。新增页面区域加容器，不往 App 里堆逻辑。
- 页面区域：顶栏（`ChromeArea`）→ 首页画廊（`GalleryArea`，见 `selectGallery`）→ 结果区（`ResultArea`：舞台、详情浮卡、轮播）→ 创作条（`CreateArea`）。**画廊就是首页**：每个并行任务在网格最前各有一张生成卡，分别显示描述、进度与取消；创作条显示任务总数并提供全部取消。保存成功后留在画廊、新记录置顶；只有点开某条记录才进结果区。画廊只展示与选中记录，不新增 store 状态。

### 3.2 store 规则

1. **存什么**：业务数据和 Blob / ImageRow；不存 Object URL、DOM 句柄、AbortController。唯一例外是 `confirm.onOk` 回调。
2. **不做 IO**：store 模块不调用 api、db、toast，也不使用 React API。
3. **怎么写**：只通过 `store/workspace/actions/` 导出的命名迁移函数（按 history/draft/run/drawing/nav/view 分文件，从 `actions` 入口导入；`actions/internal.ts` 仅目录内部使用，lint 禁止外部导入）写入。迁移函数按事件命名，可以跨切片，一次 `set` 完成；flows 和 containers 不直接调用 `setState`。需要给用户反馈的迁移函数返回结果（例如图片数量超限），由 flow 决定弹什么 toast。
4. **怎么读**：
   - 渲染时用 selector，返回原始值或 store 内已有的引用（zustand v5 的 selector 每次返回新引用会导致反复渲染）；读多个字段用 `useShallow`。
   - 禁止不带 selector 的 `useWorkspace()` / `useSettings()`。
   - 事件处理和 flows 用 `getState()`。
5. **派生值不进 state**：`displayRow`、`canReturn`、`inpaintBarInfo` 等由 selector 或 lib 计算。开销大的派生值（如画板是否有修改）只在用到时计算，不写成 selector。
6. **判定规则只写一处**：能否离开当前结果、能否打开画板、滚轮是否响应等规则在 `src/lib/workspace-rules.ts`，入口都调用它们，不各拼一份布尔条件。

### 3.3 异步流程

修改异步流程时，检查重复触发、取消、过期结果及请求成功但保存失败等路径，行为以 PRD 为准。

- **会话 id 判断过期**：上传读取（`draft.readId`）、画板（`drawing.id`）在开始时用 `crypto.randomUUID()` 生成；异步结果回来后与 `getState()` 里的 id 比对，不一致就丢弃。不用递增计数 ref 做 token。
- **占位用迁移函数**：每次提交立即创建独立生成任务，可以并行执行；同一时间仍只有一个画板。占位（`beginRun`、`beginInpaintOpening`）是"判断与写入同步完成"的迁移函数，不用 ref 加锁。生成事件、保存与取消按任务 id 隔离，AbortController 只在 flow 中按 id 管理。
- **延迟回调重新读状态**：`confirm.onOk`、`await` 之后，守卫条件和要修改的状态一律重新 `getState()`；用户发起请求时的意图（操作哪条记录、是不是当前记录）在请求时确定并作为参数带入，不在执行时重新推断。
- **取消**：进行中请求的 AbortController 只放在 flow 的模块变量里，不进 store。

### 3.4 组件与接线

1. **展示组件是受控组件**：数据与回调全部由调用方通过 props 传入。组件内**禁止** import zustand store、调用 `src/api/*`、读写 Dexie / localStorage、直接 fetch。
2. **接口只暴露调用方需要控制的**：props 描述「要什么数据、何时发生什么」。不把 store 快照、领域对象整包传给只关心局部状态的组件——容器先投影；渲染对象本身的组件例外（如结果检查器可收整条 history 记录）。回调传最小标识（id），不传整对象。
3. **区分交互规则与业务规则**：弹层开合、焦点、行内草稿和展示联动留在组件内，不通过 props 让容器管理内部细节。尺寸是否合法、是否允许提交等业务规则保持唯一实现，优先放在 `src/lib/` 纯函数中，供组件与编排层复用；组件可显示校验结果，提交入口仍须拦截非法输入。
4. **状态唯一来源、数据流单向**：共享状态由 store 维护，局部 UI 状态留在组件。受控值禁止镜像到内部 state；派生值直接计算，仅计算昂贵或确需稳定引用时用 `useMemo`。禁止修改 props 数据，禁止在渲染过程中发请求或改外部状态。
5. **副作用有生命周期**：组件与容器内的定时器、事件监听、观察器只在具体状态区间挂载，离开即清理，并在注释中列明。Object URL 只在 hooks 里创建和回收。
6. **界面文案走 i18n 资源**：组件、容器、flows 里不写死用户可见文字（含 `aria-label`、`title`、`placeholder`、`alt`、toast、确认框）；`pnpm check:i18n` 检查。lib、store、api、db 不产出文案，返回码或结构化数据（如 `SizeIssue`、`InpaintIssue`、`UploadIssue`、`InputNaming`、`ApiError.detail`），由组件或 flow 翻译。新增文案：先在 `zh-CN.ts` 加 key，再在 `en.ts` 补译；带数量的名词写 `_one` / `_other`；不拼句子，整句进资源，语序交给翻译。组件里用 `useTranslation()` 的 `t`，这样切换语言才会重渲染；调用 `fmtTime` 等依赖语言的格式化也要如此。用户内容（画面描述、上传的文件名、服务端返回的原文）不翻译。

## 4. 变更与界面准则

1. **改动聚焦**：沿用现有模式，改动范围与任务一致；不顺手重构无关模块，不为尚未出现的需求增加配置、扩展点或依赖。
2. **职责单一、优先组合**：一句话能说清组件用途；拆分应降低理解成本或消除重复规则，不把每个 div 变成组件。等稳定共性出现再抽象，视觉相似不代表业务语义相同。
3. **交互完整、可访问**：覆盖加载、空数据、错误、禁用、长文本；语义化 HTML、键盘可达、focus-visible 可见；尊重 `prefers-reduced-motion`。
4. **样式可控**：视觉规范见 PRD §5.3（`--pm-*` 令牌、发丝线、单强调色 `#FF9A62`——accent 只用于选中环/主按钮/焦点/CTA）；样式不外溢、不依赖全局选择器。

## 5. 数据与隐私边界（不可破坏）

- 持久化**只有两处**：IndexedDB（`PicMake` 库）+ localStorage（`PicMake-settings`）。新增任何其他持久化需先改 PRD
- API Key 只在请求头 `Authorization` 中发往用户配置的地址；**禁止任何第三方上报、埋点、遥测**
- 错误文案用 `src/i18n/resources` 的 `errors.*`（标题、通用建议、客户端细节），经 `src/i18n/errors.ts` 拼装，勿自创口径；服务端返回的原文原样显示，不翻译

## 6. 禁止引入

axios、openai SDK、ESLint（用 oxlint）、TanStack Query、Redux、react-router（MVP 阶段）、任何后端/服务端依赖。新增依赖前先对照 [docs/tech-stack.md](./docs/tech-stack.md) 的依赖清单原则（刻意压到最少）。

## 7. 验证与交付

- **用户偏好（覆盖下方默认测试要求）**：后续默认不运行测试（包括 `pnpm test`、`pnpm e2e`）；只做错误检查。用户明确要求时再运行测试。
- **代码改动**：执行 `pnpm lint` 和 `pnpm build`；格式使用 Prettier，仅处理本次修改的文件。
- **纯函数与 store 迁移函数的行为改动**：执行 `pnpm test`，必要时补充边界用例。vitest 在 node 环境测 `src/**/*.test.ts`：`lib/` 纯函数，以及 `store/workspace/` 的迁移函数与 selector（不依赖 DOM），验证输入输出、状态变化与非法输入拦截；不为内部重构编写绑定实现细节的测试。flows 依赖 IndexedDB、网络与 toast，除非能用假实现隔离（如 `history-sync.test.ts`），否则按下一条在浏览器验证。
- **UI 改动**：先跑 `pnpm e2e` 确认主流程（配置、生成、取消、错误、草图、局部重绘）没被破坏；再在浏览器验证受影响的交互与状态，包括键盘操作、错误与禁用状态；构建通过不能替代交互验证。生成、取消、报错路径可用 `pnpm mock` 覆盖。
- **界面文案改动**：中、英文界面都要看（设置里切换语言）。`e2e/smoke.spec.ts` 固定中文，`e2e/i18n.spec.ts` 覆盖英文界面、系统语言解析与切换，并断言英文界面没有残留中文；英文比中文长 30%–50%，注意创作条 chip、弹层与按钮是否溢出。
- **仅文档改动**：检查内容、引用路径与格式，无需运行应用构建和测试。
- **提交前**：检查最终 diff，执行 `git diff --check`，只提交本次任务的文件，保留用户已有改动。
- **交付时**：说明改了什么、实际执行的检查及结果、尚未验证的部分。检查失败须说明原因；区分 Mock 验证与真实 API 验证。
