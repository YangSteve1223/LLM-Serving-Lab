# Learning Assistant Agent

这是一个可嵌入学习平台的右侧 AI 助教模块。它不是独立聊天机器人，而是接收平台或本地测试台传入的学习上下文，再基于当前页、讲稿、大纲、学习者画像和本地知识库证据回答学生问题。

## 当前诊断结论

重构前的 answer 链路是混合模式：

- 如果注入了 `LLMClient`，会调用真实或 mock LLM。
- 如果没有注入 LLM，会走本地 `synthesizeAnswer` 模板 fallback。
- 旧模板会把 `currentPage`、`teacherScript`、`neighborPages` 和知识库片段直接拼进答案。
- 旧 citations 基本按 policy 全列，不能保证每条引用都真正支持回答。
- `teacherScript: auto_summary` 会把当前页摘要伪装成讲稿，容易造成重复和误导。

这次重构后，agent 先做问题分析、证据选择和可回答性判断，再决定是否生成答案。没有证据时，尤其是公式、数值推导、预算表、专有名词精确定义这类问题，会明确拒绝编造。

## 核心能力

- 读取 `.pptx`、`.md`、纯文本学习材料。
- 支持把 PPTX 归一化为 Markdown，优先可读文本，避免依赖 OCR。
- 可引用 `pptx2md\pptx2md` 外部转换器，失败时回退到内置 OpenXML 解析。
- 支持把当前 PPT 页渲染为 PNG 视觉预览，并在 UI 左侧与 `pageIndex` 同步展示。
- 预览缓存位于 `.cache/slide-previews/{materialHash}`；同一 PPT 未变化时会复用缓存。
- 自动修复页标题，不再把纯数字页码 `1` 当作语义标题。
- 没有平台大纲时，从 deck 页标题推断临时大纲。
- 平台传入 teacher script 时优先使用；PPT speaker notes 可作为讲稿；自动摘要单独放在 `currentPageSummary`。
- 用户可以自由输入问题，快捷按钮只作为示例入口。
- 默认 `auto` 自动规划教学策略，也支持 UI 手动覆盖讲解风格。
- 通过 `KnowledgeRetrievalSkill` 查询本地 Markdown wiki，检索结果必须过 relevance threshold 才能作为证据。
- 输出结构化 `decisionTrace`、`generationDebug`、`evidenceDebug`、`retrievalDebug`、`citations` 和 `confidence`。

## PPT 页面预览

UI 会优先使用 Windows PowerPoint COM 将 `.pptx` 每页导出为 PNG：

```text
PPTX -> .cache/slide-previews/{hash}/slide-001.png
```

加载材料后，后端会给每个 `LearningPage` 挂上：

```ts
preview?: SlidePreview
previewImageUrl?: string
```

前端只使用后端暴露的安全 URL，例如：

```text
/api/material/{materialId}/pages/{pageIndex}/preview
```

不会把本地图片绝对路径直接作为 `<img src>`。如果渲染失败，UI 会明确显示“预览渲染失败，已显示解析文本”，Markdown 仍保留在折叠调试面板里，不伪装成 PPT 画面。

## 快速运行

```powershell
cd "E:\Desktop\TASKS AND WORK\问答agent"
npm.cmd run test
npm.cmd run demo
npm.cmd run ui
```

UI 默认地址：

```text
http://127.0.0.1:4173
```

如果要指定测试 PPT 或 wiki：

```powershell
$env:TEST_PPT_DIR="E:\Desktop\TASKS AND WORK\问答agent\测试集\测试PPT"
$env:TEST_WIKI_PATH="E:\Desktop\TASKS AND WORK\问答agent\Education_LLM_Wiki_Operating_Package\Education_LLM_Wiki_Operating_Package"
npm.cmd run ui
```

## 真实 LLM 配置

支持 KIMI/Moonshot 和 OpenAI-compatible API。不要把 API key 写进代码或 README。

方式一：在 UI 里临时输入 key。前端会把 key 只随本次 `/api/ask` 请求发送给本地 server，server 只在当前请求内创建 LLM client，不保存 key。

方式二：用环境变量启动：

```powershell
$env:KIMI_API_KEY="你的 key"
$env:KIMI_MODEL="kimi-k2.5"
$env:KIMI_BASE_URL="https://api.moonshot.cn/v1"
npm.cmd run ui
```

OpenAI-compatible：

```powershell
$env:LLM_PROVIDER="openai-compatible"
$env:LLM_API_KEY="你的 key"
$env:LLM_MODEL="your-model"
$env:LLM_BASE_URL="https://example.com/v1"
npm.cmd run ui
```

如果希望 demo 没有真实模型时不返回模板答案：

```powershell
$env:REQUIRE_REAL_LLM_FOR_DEMO="true"
npm.cmd run ui
```

## 回答生成模式

每次 response 都会返回：

```ts
answerGenerationMode:
  | "real_llm"
  | "mock_llm"
  | "template_fallback"
  | "unavailable"
```

含义：

- `real_llm`：已调用真实模型。
- `mock_llm`：测试注入的 mock 模型。
- `template_fallback`：没有真实模型时使用本地、可审计的 fallback。UI 会明确显示它不是真实模型。
- `unavailable`：要求真实模型但没有可用 provider，或者真实模型调用失败且不允许 fallback。

`generationDebug` 还会返回 provider、model、是否调用 raw LLM、`llmFailureReason`、prompt preview、selected/rejected evidence 数量和 grounding 结果。KIMI `kimi-k2.5` 当前对采样参数有限制，项目里的 KIMI client 会默认不发送 temperature，并附带 `thinking: { type: "disabled" }`，避免真实模型调用失败或把输出 token 主要花在 reasoning 上。

## Grounding Mode

默认：

```ts
"allow_general_knowledge_with_label"
```

行为：当前页和知识库没有直接依据，但问题是常见通用概念时，可以基于通用知识回答，并明确标注“当前页没有直接讲，下面基于通用知识解释”。

严格模式：

```ts
"course_grounded_only"
```

行为：只允许用当前材料、讲稿、大纲和知识库证据回答。证据不足时返回资料不足。

无论哪种模式，公式、预算、精确数值、实验数据、专有名词精确定义都必须有明确证据，否则拒绝编造。

## 新增核心模块

```text
src/agents/learningAssistant/
  analysis/
    QuestionAnalyzer.ts
  grounding/
    AnswerabilityChecker.ts
    EvidenceSelector.ts
  prompts/
    answerPrompt.ts
    assistantSystemPrompt.ts
```

`QuestionAnalyzer` 识别问题意图、关键实体、是否要求公式/预算/数值等精确证据。

`EvidenceSelector` 把当前页、讲稿、大纲、前后页和知识库 chunk 当作候选证据，只选择真正相关的证据。

`AnswerabilityChecker` 判断问题能否从当前页、上下文、检索结果或通用知识回答。不能回答时，会要求拒绝编造。

## KnowledgeRetrievalSkill

本地知识库支持 Markdown 文件或文件夹。检索结果现在包含：

```ts
type RetrievalResult = {
  status: "success" | "empty" | "failed";
  query: string;
  chunks: RetrievedChunk[];
  rejectedChunks?: Array<{ chunk: RetrievedChunk; reason: string }>;
  topScore?: number;
  relevanceThreshold: number;
  evidenceSufficient: boolean;
}
```

关键变化：

- 低于阈值的 chunk 不会进入 evidence。
- RAG 问题不会因为 wiki 里有 `fragmentation` 这种包含 `rag` 字母的词而误命中。
- AlphaBetaZeta-927 这类实体不在知识库中时，retrieval 返回 `empty`。
- citations 只来自 selected evidence，不再把无关 current page/wiki 当装饰引用。

## PPTX 转 Markdown

基础命令：

```powershell
npm.cmd run pptx:md -- "测试集\测试PPT\test1.pptx" "reports\test1.learning-material.md"
```

可选外部转换器：

```powershell
$env:PPTX2MD_MODE="auto"      # auto | external | off
$env:PPTX2MD_ROOT="E:\Desktop\TASKS AND WORK\问答agent\pptx2md\pptx2md"
$env:PPTX2MD_PYTHON="python"
```

`PPTX2MD_MODE=auto` 会优先尝试外部 `pptx2md`，失败时回退到内置解析。

## 平台接入

```ts
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createMaterialProvider
} from "./src/agents/learningAssistant/index.ts";

const provider = createMaterialProvider({ type: "pptx", filePath });
const material = await provider.load({ type: "pptx", filePath });

const context = new LearningContextBuilder().build({
  material,
  pageIndex: 1,
  platformOutline,
  platformTeacherScript,
  learner,
  chatHistory
});

const kb = await MarkdownKnowledgeBase.fromPaths({
  rootDir,
  paths: ["Education_LLM_Wiki_Operating_Package/Education_LLM_Wiki_Operating_Package"]
});

const agent = new LearningAssistantAgent({
  kb,
  llm,
  groundingMode: "allow_general_knowledge_with_label"
});

const response = await agent.answer("这页主要讲什么？", context);
```

## 测试覆盖

```powershell
npm.cmd run test
```

当前 36 个测试覆盖：

- 任意 PPTX 加载和页面切换。
- 当前页自由问答。
- 不同页同一问题返回不同答案。
- PPTX 归一化为 Markdown。
- 平台大纲和教师讲稿接入。
- auto summary 不再伪装成 teacher script。
- AlphaBetaZeta-927 公式/预算压力题拒绝编造。
- RAG 问题不乱引 wiki。
- wiki 流程问题正确引用 Source Loop、Query Loop、Maintenance Loop。
- 知识库检索为空时不编造。
- 真实 LLM 未配置且要求真实模型时返回 unavailable。
- 当前页概念解释。
- 手动风格覆盖。
- LLM provider 注入和 KIMI/OpenAI-compatible client 请求结构。
- 跨 PPT 泛化：AI 基础、RAG/技术方法、视觉/医学影像等非当前 wiki 主题材料，同一问题会随当前页变化，不泄漏 wiki 系统术语。
- PPT semanticTitle 提取：优先识别真实 slide 标题，不把页码或正文句子当标题。
- current_page citation 绑定：包含 fileName、pageIndex、semanticTitle、textPreview 和 previewImageUrl。
- UI 与评测报告 Markdown 渲染：回答里的标题、列表、分隔线和表格会渲染为可读 HTML，不直接暴露 raw markdown 符号。
- “这个概念”指代消解：先从当前页提取核心概念，再用于知识库检索。
- citation 精度：标题型 chunk 不作为强证据，只保留能支撑回答的实质片段。
- decisionTrace 分数统一为 0-1；当前页摘要类问题会显式给 currentPage 高相关分。
- 中文拒答会清理 raw markdown 标题，并用中文表达缺失证据。
- 真实平台上下文 mock：验证 platform outline、teacherScript、learner profile 和 chatHistory 优先接入。

## 当前限制

- `.ppt` 暂不直接解析，需要先转换为 `.pptx`。
- PPT 图片内容暂不做 OCR 或多模态理解，只保留 alt/placeholder 信息。
- 本地检索是轻量关键词评分，后续可以替换为 embedding、向量库或平台知识库。
- 没有真实 LLM 时，fallback 只负责可审计的最小回答和拒绝编造，不伪装成完整智能模型。
- TypeScript 编译器没有安装到当前项目，`npx tsc --noEmit` 会提示需要安装 `typescript`；当前验证使用 Node 24 的 TS 运行能力和行为测试。
