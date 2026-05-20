import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");
const docsDir = path.join(root, "docs");
mkdirSync(reportsDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const now = new Date();
const generatedAt = now.toISOString();
const manualMdPath = path.join(docsDir, "LEARN_AGENT_项目完整说明书.md");
const manualDocxPath = path.join(docsDir, "LEARN_AGENT_项目完整说明书.docx");
const inventoryPath = path.join(reportsDir, "final-file-inventory.md");

const tree = buildTree(root, {
  maxDepth: 4,
  exclude: [".git", "node_modules", "删除审查区", "delete_review", "DELETE_REVIEW", ".cache"]
});
const files = listFiles(root).map((file) => rel(file));
const servingFiles = files.filter((file) => file.startsWith("src/agents/learningAssistant/serving/")).sort();
const coreFiles = [
  "src/agents/learningAssistant/LearningAssistantAgent.ts",
  "src/agents/learningAssistant/types.ts",
  "src/agents/learningAssistant/index.ts",
  "examples/learning-assistant-ui/server.ts",
  ...servingFiles,
  "scripts/run-pd-simulation.ts",
  "scripts/run-engine-benchmark.ts",
  "scripts/verify-final-artifact.js",
  "scripts/generate-code-context.js",
  "scripts/generate-project-deliverables.js"
].filter((file) => existsSync(path.join(root, file.replace(/\//g, path.sep))));
const docs = files.filter((file) => file.startsWith("docs/")).sort();
const reports = files.filter((file) => file.startsWith("reports/")).sort();
const tests = files.filter((file) => file.startsWith("tests/") && /\.(ts|md|json|txt)$/i.test(file)).sort();
const cleanupCandidates = detectCleanupCandidates(files);
const latestCleanupManifest = findLatestCleanupManifest();

writeFileSync(inventoryPath, renderInventory({ tree, coreFiles, docs, reports, tests, cleanupCandidates, latestCleanupManifest }), "utf8");
const manual = renderManual({ generatedAt, tree, coreFiles, docs, reports });
writeFileSync(manualMdPath, manual, "utf8");
writeFileSync(manualDocxPath, buildDocxFromMarkdown(manual), "binary");

console.log(`Generated ${path.relative(root, inventoryPath)}`);
console.log(`Generated ${path.relative(root, manualMdPath)}`);
console.log(`Generated ${path.relative(root, manualDocxPath)}`);

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function listFiles(dir) {
  const out = [];
  walk(dir, out);
  return out;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "删除审查区", "delete_review", "DELETE_REVIEW"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function buildTree(dir, options, depth = 0) {
  if (depth > options.maxDepth) return "";
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !options.exclude.includes(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const lines = [];
  for (const entry of entries) {
    const prefix = "  ".repeat(depth);
    lines.push(`${prefix}- ${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      const child = buildTree(path.join(dir, entry.name), options, depth + 1);
      if (child) lines.push(child);
    }
  }
  return lines.join("\n");
}

function detectCleanupCandidates(fileList) {
  return fileList
    .filter((file) => {
      const lower = file.toLowerCase();
      return (
        lower.includes("/.cache/") ||
        lower.startsWith(".cache/") ||
        lower.startsWith("reports/pptx2md-cache/") ||
        lower.startsWith("tests/serving-output/") ||
        lower.includes("/snapshots/") ||
        /(^|\/)server-smoke.*\.log$/i.test(file) ||
        /(^|\/)npm-test.*\.log$/i.test(file) ||
        /(^|\/)test-serving.*\.log$/i.test(file) ||
        /(^|\/)simulate-pd.*\.log$/i.test(file) ||
        /(^|\/)benchmark-engine.*\.log$/i.test(file) ||
        lower.endsWith(".tmp") ||
        lower.includes("/.tmp-")
      );
    })
    .sort();
}

function renderInventory(input) {
  return `# Final File Inventory\n\nGenerated at: ${generatedAt}\n\n## 1. Current Project Tree\n\n\`\`\`text\n${input.tree}\n\`\`\`\n\n## 2. Core Code Files\n\n${bullet(input.coreFiles)}\n\n## 3. Core Documents\n\n${bullet(input.docs)}\n\n## 4. Generated Reports\n\n${bullet(input.reports)}\n\n## 5. Test Files\n\n${bullet(input.tests.slice(0, 240))}\n\n## 6. Temporary / Cache / Old Snapshot Candidates\n\n${bullet(input.cleanupCandidates)}\n\n## 7. Suggested Move List\n\n${input.cleanupCandidates.length ? bullet(input.cleanupCandidates) : "- No obvious cleanup candidates found."}\n\n## 8. Move Rationale\n\n| Path Pattern | Reason | Risk | Restore |\n| --- | --- | --- | --- |\n| .cache/ | Runtime slide-preview cache regenerated by tests/UI. | low | Move the folder back to project root. |\n| reports/pptx2md-cache/ | Generated conversion cache, not source. | low | Move the folder back to reports/. |\n| tests/serving-output/ | JSONL output from trace-store tests. | low | Move the folder back to tests/. |\n| old TEST-* logs/snapshots | Historical run evidence duplicated by final reports. | low/medium | Move the directory back to tests/. |\n\n## 9. Latest Cleanup Manifest\n\n${input.latestCleanupManifest ? renderCleanupManifest(input.latestCleanupManifest) : "- No cleanup manifest found."}\n\nNo files are deleted by the cleanup process; moved files are kept under the deletion review area.\n`;
}

function bullet(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function findLatestCleanupManifest() {
  const reviewDir = ["\u5220\u9664\u5ba1\u67e5\u533a", "delete_review", "DELETE_REVIEW", "deletion_review", "_delete_review"]
    .map((name) => path.join(root, name))
    .find((candidate) => existsSync(candidate));
  if (!reviewDir) return undefined;
  const manifests = [];
  collectManifests(reviewDir, manifests);
  manifests.sort((a, b) => statSync(path.join(root, b)).mtimeMs - statSync(path.join(root, a)).mtimeMs);
  return manifests[0];
}

function collectManifests(dir, manifests) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectManifests(full, manifests);
    else if (entry.isFile() && entry.name === "MOVE_MANIFEST.md") manifests.push(rel(full));
  }
}

function renderCleanupManifest(manifestPath) {
  const fullPath = path.join(root, ...manifestPath.split("/"));
  return `Latest manifest: ${manifestPath}\n\n${readFileSync(fullPath, "utf8")}`;
}

function renderManual(input) {
  return `# LEARN_AGENT 项目完整说明书\n\n**副标题：** 一个面向教育 Agent Workload 的 Cache-aware / PD-aware LLM Serving Research Harness\n\n**日期：** ${input.generatedAt.slice(0, 10)}\n\n**作者：** Project Owner\n\n**当前状态：** Research Artifact Ready / Final Editing Pass\n\n---\n\n## 1. 一句话介绍项目\n\nLEARN_AGENT 最初是一个能读取 PPT 当前页并回答学生问题的教育助教，现在已经扩展成一个研究型工程作品：它把教育 agent 的长上下文、证据检索、prompt 构造、prefill/decode cost、prefix caching、PD serving simulator、vLLM/SGLang engine bridge 放在同一个可测试框架里。\n\n换句话说，它不是简单 RAG demo，而是一个教育 agent workload 上的 LLM serving research harness。\n\n## 2. 项目不是什么\n\n- 它不是 vLLM 或 SGLang 的替代品。\n- 它没有在当前硬件环境里完成真实 GPU-level PD disaggregation。\n- dry-run benchmark 不代表真实 latency。\n- simulator 不是 GPU benchmark。\n- quality proxy 不是人工答案质量评价。\n- 当前默认报告不会声称真实 TTFT、ITL、E2E 或真实 SLO goodput。\n\n## 3. 为什么这个项目有研究价值\n\n教育 agent 天然具有长上下文：当前 PPT 页、教师讲稿、大纲、学习者画像、聊天历史、检索证据、引用规则和输出格式都会进入 prompt。这些内容会显著影响 prefill cost。\n\n同时，同一课程、同一页面、同一课堂中的多轮问答会共享大量 prefix。例如 system policy、课程大纲、当前页内容、教师讲稿经常稳定不变，只有学生问题和少量 evidence 是动态的。因此它适合研究：\n\n- prefix caching 是否能降低重复 prefill 成本；\n- cache-aware prompt layout 是否能让 stable prefix byte-for-byte 稳定；\n- context budget 是否能在不破坏 grounding 的情况下减少 prefill tokens；\n- PD 分离场景下 prefill queue、decode queue 和 KV transfer 的 tradeoff；\n- 应用层 workload shaping 如何配合 vLLM/SGLang 这样的真实推理引擎。\n\n在没有 GPU 的情况下，trace-driven simulator 和 optional engine bridge 是合理的阶段性方案：先把 workload、trace、指标口径和实验脚手架搭好，等有 GPU 后再接真实 engine 校准。\n\n## 4. 系统总览\n\n### 4.1 模块图\n\n\`\`\`mermaid\nflowchart TD\n  UI[UI / API layer] --> Server[examples/learning-assistant-ui/server.ts]\n  Server --> Agent[LearningAssistantAgent]\n  Agent --> Context[ContextAnalyzer]\n  Agent --> Question[QuestionAnalyzer]\n  Agent --> Student[StudentModeler]\n  Agent --> Policy[PolicyPlanner]\n  Agent --> Retrieval[KnowledgeRetrievalSkill]\n  Agent --> Evidence[EvidenceSelector]\n  Agent --> Answerability[AnswerabilityChecker]\n  Agent --> LLM[LLMClient / Streaming Client]\n  Agent --> Trace[ServingTrace + RequestTraceStore]\n  Trace --> Tokens[TokenEstimator]\n  Trace --> Budget[ContextBudgetPlanner]\n  Budget --> Prompt[CacheAwarePromptBuilder]\n  Trace --> Simulator[PDServingSimulator]\n  Metrics[EngineMetricsClient] --> VLLM[vLLM metrics]\n  Metrics --> SGLang[SGLang metrics]\n  Simulator --> Reports[Reports / Docs / Tests]\n  Prompt --> Reports\n\`\`\`\n\n### 4.2 核心层次\n\n| 层次 | 作用 | 关键文件 |\n| --- | --- | --- |\n| UI/API | 接收用户问题、材料、模型配置，返回 answer 和 trace。 | examples/learning-assistant-ui/server.ts |\n| Education Agent | 分析上下文、检索证据、判断可回答性、生成回答。 | LearningAssistantAgent.ts |\n| Grounding | 决定证据是否足够，避免编造。 | EvidenceSelector.ts, AnswerabilityChecker.ts |\n| Serving Trace | 记录 phase latency、token estimate、context cost。 | ServingTrace.ts, PhaseTimer.ts, TokenEstimator.ts |\n| PD Simulator | 对 monolithic / PD / hybrid 做 trace-driven what-if。 | PDServingSimulator.ts |\n| Engine Bridge | 可选接 vLLM/SGLang/OpenAI-compatible endpoint。 | StreamingOpenAICompatibleClient.ts, EngineMetricsClient.ts |\n| Benchmark | 生成 dry-run 或真实 endpoint benchmark report。 | run-engine-benchmark.ts |\n| Docs/Tests | 说明项目边界并防止误导性报告。 | docs/, tests/serving/ |\n\n## 5. 一次 /api/ask 的完整调用链\n\n一次问答请求大致经过：\n\n\`\`\`text\nrequest\n  -> buildContext\n  -> agent.answer\n  -> analyzeContext\n  -> analyzeQuestion\n  -> inferLearnerState\n  -> planPolicy\n  -> retrieveEvidence\n  -> selectEvidence\n  -> checkAnswerability\n  -> buildPrompt\n  -> generateAnswer\n  -> attachServingTrace\n  -> response\n\`\`\`\n\n### 5.1 server.ts\n\nUI server 接收 /api/ask 请求，读取当前 material、pageIndex、learner profile、chat history、LLM 配置和 serving 配置。它负责构造 LearningContext，并创建 LearningAssistantAgent。\n\n### 5.2 LearningAssistantAgent.answer\n\nAgent 不是直接把问题扔给 LLM，而是先拆成多个可观察阶段：context analysis、question analysis、student modeling、policy planning、retrieval、evidence selection、answerability check、prompt build、LLM/fallback generation。每个阶段都可以被 PhaseTimer 记录。\n\n### 5.3 Evidence 和 answerability\n\nAgent 只把真正相关的 current page、teacher script、outline、neighbor page、wiki evidence 放入 selected evidence。对于公式、预算、精确数值、实验数据等问题，如果没有明确证据，就应该拒绝编造。\n\n### 5.4 Serving trace\n\n回答生成后，系统附加 servingTrace，包括 requestId、tokenEstimate、latencyMs、simulatedPD、contextBudgetSuggestion、retrievalStatus、selectedEvidenceCount、confidence 等。trace 不保存 raw prompt、raw answer、API key。\n\n## 6. 教育 Agent 设计\n\n普通 chatbot 往往只看用户当前一句话；LEARN_AGENT 的教育 agent 需要理解当前学习页面、课程上下文、教师讲稿、学习者状态和历史对话。\n\n| 设计点 | 为什么需要 |\n| --- | --- |\n| Answerability | 明确问题是否能从当前资料回答，防止幻觉。 |\n| Citations | 告诉用户答案依据来自当前页、讲稿、wiki 或通用知识。 |\n| Confidence | 给 UI 和评测一个粗粒度可信度信号。 |\n| DecisionTrace | 解释 agent 为什么选这个策略和证据。 |\n| GenerationDebug | 开发者查看 provider、model、mode、fallback 和证据状态。 |\n| Grounding | 课程场景不能为了流畅而编造公式、数据或结论。 |\n\n## 7. Serving Trace 设计\n\nServing trace 的目标不是记录用户隐私，而是记录性能和成本结构：\n\n- contextAnalysis、questionAnalysis、retrieval、evidenceSelection、answerability、promptBuild、llmWallClock、total latency；\n- estimatedPrefillTokens、estimatedDecodeTokens、cacheablePrefixTokens；\n- selected evidence token cost；\n- simulated TTFT/TPOT/KV transfer；\n- context budget suggestion。\n\n它不保存 raw prompt、raw answer、API key，因为这些可能包含学生隐私、课程内容和密钥。报告只保存 hash、长度、统计值和 sourceType 聚合信息。\n\n## 8. TokenEstimator\n\nTokenEstimator 是 deterministic heuristic，不是精确 tokenizer。它用汉字数量、英文单词、数字、标点和混合间隔估算 token 数。\n\n为什么可以先这样做：\n\n- 当前目标是 workload shape 和相对变化，不是 tokenizer 级精确 billing。\n- heuristic 可单元测试、无外部依赖、离线可跑。\n- 后续接真实 vLLM/SGLang 时，可用 engine usage tokens 或 tokenizer 替换。\n\n未来改进：接 tiktoken、HuggingFace tokenizer 或 vLLM/SGLang 自身 tokenizer 输出。\n\n## 9. PDServingSimulator\n\n### 9.1 基础概念\n\n| 术语 | 含义 |\n| --- | --- |\n| Prefill | 模型处理 prompt 上下文并生成 KV cache 的阶段。 |\n| Decode | 模型逐 token 生成输出的阶段。 |\n| TTFT | Time To First Token，首 token 延迟。 |\n| ITL/TPOT | Inter-token latency / Time Per Output Token，输出 token 间隔。 |\n| E2E latency | 端到端完成时间。 |\n| SLO | 服务等级目标，如 TTFT < 800ms。 |\n| Goodput | 满足 SLO 的请求比例。dry-run 中不能当真实 goodput。 |\n\n### 9.2 三种策略\n\n| 策略 | 模拟含义 |\n| --- | --- |\n| monolithic_shared | prefill 和 decode 在同一 worker pool 中争用资源。 |\n| pd_disaggregated | 请求先进入 prefill queue，再经过 KV transfer，最后进入 decode queue。 |\n| hybrid | 简化的混合策略，近似 cache-aware prefill 和 SLO-aware decode prioritization。 |\n\n这个 simulator 是 trace-driven what-if analysis，不是真实 GPU 结果。报告必须写 Measurement mode: simulated。\n\n## 10. ContextBudgetPlanner\n\n上下文越长，prefill cost 越高。但教育 agent 不能为了省 token 破坏 grounding。ContextBudgetPlanner 默认 observe-only，只给 suggestion，不直接改变答案。\n\n| Policy | 适用场景 | 风险 |\n| --- | --- | --- |\n| full | 需要完整上下文或证据不确定。 | token cost 高。 |\n| evidence_top_k | evidence 很多但 top evidence 足够。 | 可能漏掉弱相关证据。 |\n| current_page_only | 问题明确只问当前页。 | 不适合跨页/知识库问题。 |\n| compressed | 证据冗长但不要求精确数值。 | 可能损失细节。 |\n| cache_first | 同 material/page 多轮重复，追求 stable prefix。 | 单次 prompt 可能更长。 |\n\n## 11. CacheAwarePromptBuilder\n\nCacheAwarePromptBuilder 把 prompt 拆成 components，并尽量让 stable prefix 稳定：system、course policy、outline、current page、teacher script 等放在前面；selected evidence、learner profile、chat history、question 放在后面。\n\n关键点：\n\n- stable prefix 必须 byte-for-byte 稳定；\n- requestId、timestamp、随机 debug 信息不能放入 stable prefix；\n- 同一 material/page 的 stablePrefixHash 应该不随 question 变化；\n- cache_first 可能让单次 prompt 更长，但希望通过 prefix cache 命中摊销成本；\n- break-even cache hit rate = extraTokens / reusableTokens。若大于 1，说明在当前 heuristic token model 下需要超过 100% 命中率，不值得直接宣称收益。\n\n## 12. SOTA Engine Bridge\n\nEngine bridge 让项目以后能接真实 engine：\n\n- StreamingOpenAICompatibleClient：调用 /v1/chat/completions stream=true，解析 SSE chunk，记录 TTFT、ITL、E2E。\n- PrometheusMetricsParser：解析 /metrics 文本格式。\n- VllmMetricsAdapter：归一化 vLLM metrics，如 prefix cache、prompt tokens、generation tokens、TTFT、ITL。\n- SglangMetricsAdapter：归一化 SGLang metrics，如 cache hit rate、token usage、running reqs。\n- EngineBenchmarkRunner：对 full、evidence_top_k、current_page_only、cache_first replay workload。\n\n如果 endpoint 不支持 streaming，只能记录 full response wall-clock，不能伪造 TTFT/ITL。如果没有 /metrics，就不能报告真实 prefix cache hit。\n\n## 13. vLLM / SGLang 的关系\n\nvLLM/SGLang 是真实推理引擎，本项目是 workload / application / benchmark harness。本项目不重写 PagedAttention、RadixAttention、continuous batching 或 KV cache manager。它研究的是应用层 prompt/context assembly 如何更适合这些 engine。\n\n## 14. 当前实验结果怎么读\n\n| 命令 | 当前含义 |\n| --- | --- |\n| npm run test:serving | serving 模块、report truthfulness、engine bridge 解析、cache prompt tests 通过。 |\n| npm test | 原教育 agent 主功能通过，说明研究层没有破坏主链路。 |\n| npm run simulate:pd | 生成 estimated/simulated PD what-if report。 |\n| npm run benchmark:engine | dry-run，只验证 workload shape 和 prompt accounting。 |\n| npm run verify:final | 统一跑最终检查和安全扫描。 |\n\nTTFT/ITL/E2E 在 dry-run 中显示 n/a 是正确的，因为没有真实 streaming endpoint。dry-run 里的 Workload success 不能解释为 actual SLO goodput。\n\n## 15. 项目文件结构\n\n\`\`\`text\n${input.tree}\n\`\`\`\n\n## 16. 每个核心文件解释\n\n${renderCoreFileGuide(input.coreFiles)}\n\n## 17. 测试体系\n\n| 测试类别 | 目的 |\n| --- | --- |\n| token-estimator tests | 确认 heuristic token estimate deterministic，长文本 token 更多。 |\n| context-budget-planner tests | 确认精确证据问题不被 aggressive compression。 |\n| simulator tests | 确认 prefill/decode 增加会影响 TTFT/TPOT/E2E，策略比较稳定。 |\n| trace-store tests | 确认 ring buffer 和 JSONL 不泄露 raw prompt/API key。 |\n| engine tests | 确认 SSE、Prometheus、vLLM/SGLang adapter、cache prompt、report truthfulness。 |\n| docs smoke tests | 确认文档明确写出限制和真实指标要求。 |\n\n测试失败时，先判断是哪一层：业务问答、serving 模块、报告口径、文件路径、外部环境。不要把测试期望改弱来掩盖真实问题。\n\n## 18. 安全与隐私\n\n- reports 不保存 raw prompt。\n- reports 不保存 raw answer。\n- reports 不保存 API key。\n- RequestTraceStore 只保存 hash、token estimate、latency、sourceType 聚合和模式信息。\n- CODE_CONTEXT_FOR_AI 会过滤二进制、node_modules、.git、删除审查区，并对 sk-* 形态做 redaction。\n\n## 19. 12 周学习路线\n\n### 第 1-2 周：读懂项目本体\n\n学习 TypeScript、Node.js API server、Agent pipeline、RAG/evidence/citations。重点读 server.ts、LearningAssistantAgent.ts、types.ts。练习：手动画出一次 /api/ask 调用链。\n\n### 第 3-4 周：LLM serving 基础\n\n学习 prefill、decode、TTFT、ITL、TPOT、E2E、KV cache、batching、queueing、SLO、goodput。重点读 TokenEstimator、PhaseTimer、ServingTrace、PDServingSimulator。练习：改 qps/workers，看 decode queue 如何变化。\n\n### 第 5-6 周：Prefix caching 与 prompt engineering\n\n学习 stable prefix、dynamic suffix、prefix cache hit、prompt canonicalization、RadixAttention 思想。重点读 CacheAwarePromptBuilder、PromptComponentHasher。练习：比较 same page / different question 的 stablePrefixHash。\n\n### 第 7-8 周：vLLM / SGLang\n\n学习 vLLM PagedAttention、continuous batching、chunked prefill、prefix caching metrics、SGLang RadixAttention 和 scheduler。重点读 StreamingOpenAICompatibleClient、PrometheusMetricsParser、VllmMetricsAdapter、SglangMetricsAdapter。练习：解释为什么 dry-run 没有 TTFT。\n\n### 第 9-10 周：PD disaggregation\n\n学习 DistServe、prefill/decode 资源分离、KV transfer、LMCache、NIXL、Mooncake 类 KVCache-centric 思想。练习：用 simulator 写一页实验观察，说明 TTFT 改善和 E2E 变差可能同时发生。\n\n### 第 11-12 周：研究表达\n\n学习如何写实验报告、如何区分 actual/estimated/simulated、如何做 ablation、如何向老师解释项目。练习：准备 5 分钟 oral presentation。\n\n## 20. 关键术语表\n\n| 术语 | 解释 |\n| --- | --- |\n| Agent | 能感知上下文、选择行动并返回结构化结果的智能体。 |\n| RAG | Retrieval-Augmented Generation，用检索证据增强回答。 |\n| Evidence | 支撑答案的材料片段。 |\n| Citation | 答案引用的证据来源。 |\n| Grounding | 答案必须被材料或证据支撑。 |\n| Answerability | 判断当前证据是否足以回答。 |\n| Confidence | 回答可信度信号。 |\n| Decision trace | agent 决策过程记录。 |\n| Prefill | 处理 prompt 并生成 KV cache。 |\n| Decode | 逐 token 生成输出。 |\n| TTFT | 首 token 延迟。 |\n| ITL | token 间延迟。 |\n| TPOT | 每输出 token 时间。 |\n| E2E latency | 端到端延迟。 |\n| KV cache | Transformer attention 的 key/value 缓存。 |\n| Prefix caching | 复用相同 prompt prefix 的 KV cache。 |\n| Stable prefix | 多请求间稳定复用的 prompt 前缀。 |\n| Dynamic suffix | 每次请求变化的 prompt 后缀。 |\n| Prompt canonicalization | 将 prompt 组件稳定排序和格式化。 |\n| PagedAttention | vLLM 的 KV cache 管理思想。 |\n| RadixAttention | SGLang 的 prefix 复用结构思想。 |\n| Continuous batching | 动态批处理请求以提高吞吐。 |\n| Chunked prefill | 将 prefill 拆块调度。 |\n| PD disaggregation | prefill/decode 分离部署。 |\n| KV transfer | prefill 产生的 KV cache 传给 decode 侧。 |\n| SLO | 服务等级目标。 |\n| Goodput | 满足 SLO 的有效吞吐比例。 |\n| vLLM | 高性能 LLM inference engine。 |\n| SGLang | 面向结构化生成和高效 serving 的系统。 |\n| LMCache | KV cache reuse/offload 相关系统。 |\n| NIXL | NVIDIA Inference Xfer Library，常用于讨论 KV transfer。 |\n| Prometheus metrics | engine 暴露的监控指标文本格式。 |\n| Dry-run | 不调用真实 endpoint，只生成 workload 和 prompt stats。 |\n| Simulator | 用假设参数做 what-if analysis。 |\n| Quality proxy | 用 confidence/refusal/citation 等近似观察质量，不等于人工评价。 |\n\n## 21. 2 分钟讲解稿\n\n我最初做的是一个教育场景的 AI 助教，它能感知当前 PPT 页、教师讲稿、课程大纲、学习者画像和知识库证据，而不是只做普通聊天。后来我发现这种教育 agent 的 prompt 很长，而且有很多稳定重复的结构，比如同一页课件、同一段教师讲稿和相同的 grounding rules，这正好对应 LLM serving 里的 prefill cost 和 prefix cache 问题。\n\n因为我现在没有 GPU 环境，所以我没有伪造真实 PD 分离实验，而是做了一个 research harness：它会记录安全的 serving trace，估算 prefill/decode tokens，做 trace-driven PD simulator，并提供 cache-aware prompt canonicalization 和 vLLM/SGLang engine bridge。dry-run 只验证 workload shape，simulator 只做 what-if，真实 TTFT/ITL/E2E 需要以后接 streaming endpoint。\n\n这个项目的研究问题是：应用层 agent 如何通过 context budget、prompt layout 和 cache-aware prefix 设计，更好地适配 vLLM/SGLang 这样的 serving engine。\n\n## 22. 5 分钟讲解稿\n\n我做的 LEARN_AGENT 不是普通 RAG demo。它的第一层是教育 agent：读取 PPT、当前页、讲稿、大纲、学习者状态和本地 wiki evidence，然后通过 question analysis、policy planning、retrieval、evidence selection、answerability checking 来回答学生问题。它强调 citations、confidence 和 refusal，因为教育场景不能随便编造公式、数字或课程结论。\n\n第二层是 serving observability。我在 /api/ask 链路里加入 PhaseTimer 和 ServingTrace，记录每个阶段的本地 wall-clock latency，并用 TokenEstimator 估算 prefill tokens、decode tokens、selected evidence tokens 和 cacheable prefix tokens。trace 不保存 raw prompt、raw answer 或 API key，只保存 hash 和统计值。\n\n第三层是 PD-aware simulator。它把 workload 变成 prefillTokens/decodeTokens/request arrival，然后比较 monolithic_shared、pd_disaggregated 和 hybrid 三种策略。这里我非常明确地标注 simulated/estimated，因为这不是 GPU 实测。它的价值是帮助我理解 TTFT、TPOT、E2E、queueing 和 worker utilization 的关系。\n\n第四层是 cache-aware prompt canonicalization。教育 agent 的上下文很适合 prefix caching，因为同一课程同一页里有大量稳定 prefix。我把 prompt 拆成 system、course policy、outline、current page、teacher script、evidence、learner profile、chat history 和 question 等组件，并计算 stablePrefixHash。cache_first 可能让单次 prompt 更长，所以我加入 break-even cache hit rate，避免把 dry-run 误读成真实性能提升。\n\n第五层是 SOTA engine bridge。以后有 GPU 时，可以用 OpenAI-compatible streaming endpoint 接 vLLM 或 SGLang，测真实 TTFT/ITL/E2E，也可以抓 /metrics 里的 prefix cache hit、prompt tokens、generation tokens 等指标。当前 dry-run 没有真实 endpoint，所以 latency 是 n/a，这是正确口径。\n\n这个项目现在可以冻结为一个工程研究 artifact。下一步不是继续堆功能，而是深入学习 vLLM、SGLang、PD disaggregation、KV cache transfer 和实验设计，然后有 GPU 时用真实 engine 校准 simulator。\n\n## 23. 项目最终状态\n\n项目可以冻结。接下来重点不是继续添加功能，而是学习和理解：读 docs/learning-guide.md，按 12 周路线看源码和相关 serving 系统。真正有 GPU 后，再接 vLLM/SGLang 做真实 streaming latency、prefix cache hit 和 PD disaggregation 实验。\n`;
}

function renderCoreFileGuide(files) {
  const descriptions = new Map([
    ["src/agents/learningAssistant/LearningAssistantAgent.ts", "教育 agent 主链路。输入 query/context，输出 answer、citations、debug、servingTrace。重点看 answer() 的阶段划分。"],
    ["src/agents/learningAssistant/types.ts", "全局类型定义。学习时重点看 LearningContext、LearningAssistantResponse、EvidenceCandidate。"],
    ["examples/learning-assistant-ui/server.ts", "本地 API server。负责 /api/ask、serving traces、simulate、engine probe/replay。"],
    ["src/agents/learningAssistant/serving/TokenEstimator.ts", "启发式 token 估算器。输入文本/evidence/context，输出 prompt token breakdown。"],
    ["src/agents/learningAssistant/serving/PDServingSimulator.ts", "trace-driven PD simulator。输入 workload/config，输出三种 serving policy 的 estimated metrics。"],
    ["src/agents/learningAssistant/serving/CacheAwarePromptBuilder.ts", "把 prompt 拆成稳定前缀和动态后缀，计算 hash 与 cache prediction。"],
    ["src/agents/learningAssistant/serving/engines/StreamingOpenAICompatibleClient.ts", "OpenAI-compatible streaming client。真实 TTFT/ITL 只有 streaming 时才可测。"],
    ["src/agents/learningAssistant/serving/engines/PrometheusMetricsParser.ts", "Prometheus text parser，用于 vLLM/SGLang /metrics。"],
    ["scripts/run-pd-simulation.ts", "离线 PD simulation CLI，生成 reports/pd-simulation.*。"],
    ["scripts/run-engine-benchmark.ts", "engine benchmark CLI，默认 dry-run，真实 endpoint 可选。"],
    ["scripts/verify-final-artifact.js", "最终验证脚本，统一跑测试、报告、文档和安全扫描。"]
  ]);
  return files.map((file) => `### ${file}\n\n- 职责：${descriptions.get(file) ?? "核心项目文件，支撑 agent、serving、benchmark 或验证流程。"}\n- 输入：来自上游 context、trace、workload、engine metrics 或 CLI 参数。\n- 输出：结构化 response、trace、report、test result 或文档产物。\n- 关系：与 LearningAssistantAgent、serving 模块、scripts 或 tests 相互验证。\n- 学习重点：先看 public type/function，再看测试如何调用它。`).join("\n\n");
}

function buildDocxFromMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const body = [];
  let inCode = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (!inCode && /^\|\s*---/.test(line)) continue;
    if (!inCode && line.startsWith("| ")) {
      const tableLines = [];
      while (index < lines.length && lines[index].startsWith("| ")) {
        if (!/^\|\s*---/.test(lines[index])) tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      if (tableLines.length) body.push(table(tableLines));
      continue;
    }
    const clean = cleanMarkdown(line);
    if (!clean.trim()) {
      body.push(paragraph(""));
    } else if (line.startsWith("# ")) {
      body.push(paragraph(clean.replace(/^#\s+/, ""), "Title"));
    } else if (line.startsWith("## ")) {
      body.push(paragraph(clean.replace(/^##\s+/, ""), "Heading1"));
    } else if (line.startsWith("### ")) {
      body.push(paragraph(clean.replace(/^###\s+/, ""), "Heading2"));
    } else if (/^---+$/.test(clean.trim())) {
      body.push(paragraph(""));
    } else if (line.startsWith("- ")) {
      body.push(paragraph(`• ${clean.replace(/^-\s+/, "")}`, "ListParagraph"));
    } else if (inCode) {
      body.push(paragraph(clean, "Code"));
    } else {
      body.push(paragraph(clean, "Normal"));
    }
  }
  const documentXml = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1100" w:bottom="1200" w:left="1100" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const stylesXml = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="260"/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="1F4E79"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:spacing w:before="260" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="1F4E79"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:pPr><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="2F6F4E"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="18"/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`);
  const contentTypes = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  const rels = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const docRels = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  return makeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: stylesXml }
  ]);
}

function cleanMarkdown(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
}

function table(tableLines) {
  const rows = tableLines.map((line) => line.split("|").slice(1, -1).map((cell) => cleanMarkdown(cell.trim())));
  const grid = rows[0]?.map(() => '<w:gridCol w:w="2200"/>').join("") ?? "";
  const body = rows
    .map((row, rowIndex) =>
      `<w:tr>${row
        .map(
          (cell) =>
            `<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:shd w:fill="${rowIndex === 0 ? "D9EAF7" : "FFFFFF"}"/></w:tcPr>${paragraph(
              cell,
              "TableText"
            )}</w:tc>`
        )
        .join("")}</w:tr>`
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C9D6"/><w:left w:val="single" w:sz="4" w:color="B7C9D6"/><w:bottom w:val="single" w:sz="4" w:color="B7C9D6"/><w:right w:val="single" w:sz="4" w:color="B7C9D6"/><w:insideH w:val="single" w:sz="4" w:color="B7C9D6"/><w:insideV w:val="single" w:sz="4" w:color="B7C9D6"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function paragraph(text, style = "Normal") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xml(value) {
  return Buffer.from(value, "utf8");
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  }
  const centralStart = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
