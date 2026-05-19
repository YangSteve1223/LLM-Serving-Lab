# Learning Assistant Agent Portable Package

本包是一个可移植的学习助教 agent 原型，包含核心源码、测试 PPT、Education LLM Wiki 知识库、TEST-2009 验收结果和可运行的测试台。

## 运行环境

- Node.js 24 或更高版本。
- Windows 环境推荐安装 Microsoft PowerPoint，用于导出 PPT slide 预览图。
- 如果没有 PowerPoint，agent 仍可读取 PPTX 文本并回答，但 slide 视觉预览可能显示为 failed / unavailable。
- 不包含 Node.js 本体，也不包含 API key。

## 快速开始

在包根目录运行：

```powershell
npm install
npm run test:2009
```

如需使用真实 KIMI / Moonshot 模型：

```powershell
$env:KIMI_API_KEY="你的临时密钥"
npm run test:2009
Remove-Item Env:\KIMI_API_KEY
```

密钥只从运行时环境读取，测试输出会自动脱敏，不会写入报告、JSON、CSV、截图或 raw response。

## 打开测试台

```powershell
npm run ui
```

服务启动后，终端会显示本地访问地址。新版 UI 默认是演示模式，首屏是“左侧大课件 + 右侧 AI 助教聊天”。它支持加载 PPT、切换页面、显示当前 slide 预览、自由提问、选择 learner profile / style preference。

进入模式：

- 演示模式：默认打开，也可以访问 `http://127.0.0.1:4173/?mode=demo`。
- 开发模式：点击右上角“开发模式”，或访问 `http://127.0.0.1:4173/?mode=developer`。

调试能力仍然保留在页面底部折叠区：

- `证据与引用`
- `开发调试`
- generation mode
- answerability
- skill / retrieval
- selected / rejected evidence
- decision trace
- raw response

模型设置在右上角“模型设置”中展开。API key 只用于本次会话请求，不保存。

## 运行 TEST-2009

```powershell
npm run test:2009
```

输出目录：

```text
tests\TEST-2009
```

主要结果：

- `evaluation-report.html`：可视化验收报告，包含每个 case 的 PPT 当前页截图、回答、证据和断言结果。
- `evaluation-results.json`：结构化结果。
- `EXPERIMENT-LOG-SUMMARY.md`：便于快速阅读的实验摘要。
- `RUN-SUMMARY.txt`：关键指标摘要。
- `summary.csv`：每个 case 一行的统计表。
- `slide-previews/`：每个 case 对应的 PPT 页图片。
- `raw-responses/`：脱敏后的原始响应。

## 目录说明

- `src/agents/learningAssistant`：agent 核心模块。
- `examples/learning-assistant-ui`：本地测试台。
- `tests/learningAssistant`：单元和行为测试。
- `tests/TEST-2009`：综合验收测试定义、runner 和最新结果。
- `测试集/测试PPT`：随包附带的 4 个测试 PPT。
- `Education_LLM_Wiki_Operating_Package`：本地 markdown 知识库。
- `pptx2md`：PPT 转 markdown 相关脚本和依赖接口。

## 核心接口

核心入口：

```ts
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createMaterialProvider
} from "./src/agents/learningAssistant/index.ts";
```

典型流程：

```ts
const provider = createMaterialProvider({ type: "pptx", filePath });
const material = await provider.load({ type: "pptx", filePath });

const context = new LearningContextBuilder().build({
  material,
  pageIndex: 1,
  learner: { profile: { level: "beginner", language: "zh" } }
});

const agent = new LearningAssistantAgent({
  kb,
  llm,
  groundingMode: "allow_general_knowledge_with_label"
});

const response = await agent.answer("这页主要讲什么？", context);
```

响应包含：

- `answer`
- `decisionTrace`
- `usedContext`
- `usedSkills`
- `citations`
- `teachingPolicy`
- `confidence`
- `generationDebug`
- `retrievalDebug`
- `evidenceDebug`

## 当前边界

- 真实平台 API 尚未接入，本包使用 mock platform outline / teacherScript 验证接口形态。
- PPT 视觉预览依赖本机可用的渲染工具；文本解析和问答不依赖预览成功。
- 知识库当前是 markdown chunk 检索，后续可以替换为向量数据库或平台知识库。
- 模型能力取决于运行时配置的 LLM provider；未配置真实模型时，demo 会明确显示不可用或 fallback 模式。
