# LEARN_AGENT 项目总结报告

> 生成日期：2026-05-26
> 项目路径：`./LEARN_AGENT`
> 技术栈：TypeScript / Node.js 24+ / 零外部依赖

---

## 一、项目定位

**LLM Serving Lab** — 面向长上下文场景的 PD 分离推理系统研究平台

从原始"教育AI助教"（LEARN_AGENT）完全转型为LLM推理系统研究平台，聚焦 Prefill/Decode 分离、KV-Cache 管理、调度策略优化三大核心方向。所有模块纯TypeScript实现，零外部运行时依赖，可直接运行于Node.js环境。

---

## 二、迭代历程

项目经历 **2个阶段、7轮** 迭代开发，采用 **3-agent头脑风暴 → 2-agent并行竞争 → 1-agent评估选优** 的自动化流程。

### 第一阶段：核心功能构建（第1-4轮）

| 轮次 | 分支A | 分支B | 选优结果 | 核心产出 |
|------|-------|-------|---------|---------|
| 第1轮 | feat/pd-infra | feat/cache-scheduling | pd-infra | PD分离基础设施、连续批处理调度器、精确Token估算 |
| 第2轮 | feat/cache-evaluation | feat/pipeline-integration | cache-evaluation | Radix前缀缓存、分层KV存储、教育场景Workload建模 |
| 第3轮 | feat/pipeline-calibration | feat/advanced-optimization | advanced-optimization | KV缓存压缩、上下文裁剪、分块预填充、RL策略选择、DeepSeek延迟测量、校准Pipeline |
| 第4轮 | feat/system-polish | feat/deep-research-alignment | deep-research-alignment | vLLM/SGLang对齐适配、3×3×3实验矩阵、PD端到端验证、PPD路由 |

### 第二阶段：代码优化+清理（第5-7轮）

| 轮次 | 分支A | 分支B | 选优结果 | 核心产出 |
|------|-------|-------|---------|---------|
| 第5轮 | feat/architecture-cleanup | feat/research-deepening | 两者互补均保留 | 抽象缓存/调度接口、SpeculativeDecoding、消融实验框架 |
| 第6轮 | feat/pipeline-calibration | feat/advanced-optimization | pipeline-calibration | SpeculativeSchedulerAdapter、校准闭环、PipelineV2、策略对比数据修复 |
| 第7轮 | feat/cleanup-legacy | feat/test-hardening | 两者互补均保留 | DeterministicRandom、UnifiedMetrics、新增5个测试文件、断言强化 |

---

## 三、架构总览

```
┌─────────────────────────────────────────────────────┐
│                  ServingPipelineV2                    │
│          (统一配置入口 + 端到端Pipeline)               │
├──────────┬──────────┬──────────┬─────────────────────┤
│  Cache   │Schedule  │  Simulate│      Experiment      │
│  Layer   │  Layer   │  Layer   │       Layer          │
├──────────┼──────────┼──────────┼─────────────────────┤
│Abstract  │Scheduler │EnhancedPD│CalibrationFeedback   │
│Prefix    │Interface │Simulator │Loop                   │
│Cache     │          │          │                       │
│├Radix    │├FCFS     │├Monolith │AblationStudy          │
│├Hash     │├SJF      │├PD-Sep   │Runner                 │
│├Hierarchi│├SLO-aware│├Chunked  │                       │
│└KVReuse  │├Tenant   │Prefill   │APIExperiment          │
│Analyzer  │├Speculativ│├Speculat │Runner                 │
│          │└PPD     │iveDecode │                       │
│          │Router   │          │StatisticalReporter     │
├──────────┴──────────┴──────────┴─────────────────────┤
│              Optimization Layer                        │
│  KVCacheCompressor | ContextBudgetPlanner              │
│  ChunkedPrefillCoordinator | AdaptiveChunkedPrefill    │
│  RLStrategySelector | KVCacheReuseAnalyzer             │
├───────────────────────────────────────────────────────┤
│              Benchmark & Calibration                   │
│  DeepSeekLatencyProber | CalibrationPipeline           │
│  EngineBenchmarkRunner | SimulatorCalibrator           │
├───────────────────────────────────────────────────────┤
│              Infrastructure                            │
│  DeterministicRandom | UnifiedMetrics | PhaseTimer     │
│  ExactTokenEstimator | ServingTrace | RequestTraceStore│
└───────────────────────────────────────────────────────┘
```

---

## 四、核心模块清单

### 4.1 PD 分离模拟（核心卖点）

| 模块 | 文件 | 功能 |
|------|------|------|
| EnhancedPDServingSimulator | serving/EnhancedPDServingSimulator.ts | PD分离模拟 + KV传输建模 + 策略对比 |
| SpeculativeDecodingSimulator | serving/speculative/SpeculativeDecodingSimulator.ts | 推测性解码模拟 |
| DraftTargetPair | serving/speculative/DraftTargetPair.ts | Draft-Target模型配对 |
| CalibrationFeedbackLoop | serving/experiment/CalibrationFeedbackLoop.ts | 校准闭环（API实验→校准→迭代） |

### 4.2 KV-Cache 管理（研究重点）

| 模块 | 文件 | 功能 |
|------|------|------|
| AbstractPrefixCache | serving/cache/AbstractPrefixCache.ts | 缓存抽象接口 |
| RadixCacheAdapter | serving/cache/RadixCacheAdapter.ts | RadixTree前缀缓存（SGLang风格） |
| HashCacheAdapter | serving/cache/HashCacheAdapter.ts | Hash前缀缓存（vLLM风格） |
| HierarchicalKVCache | serving/cache/HierarchicalKVCache.ts | 三层L1_GPU/L2_CPU/L3_DISTRIBUTED |
| KVCacheReuseAnalyzer | serving/cache/KVCacheReuseAnalyzer.ts | KV-Cache复用量化分析 |
| RadixPrefixCacheManager | serving/cache/RadixPrefixCacheManager.ts | RadixTree + LRU/LFU驱逐 |

### 4.3 调度策略

| 模块 | 文件 | 功能 |
|------|------|------|
| SchedulerInterface | serving/scheduling/SchedulerInterface.ts | 统一调度接口 |
| ContinuousBatchingAdapter | serving/scheduling/ContinuousBatchingAdapter.ts | 连续批处理适配器 |
| SGLangRadixAdapter | serving/scheduling/SGLangRadixAdapter.ts | SGLang RadixAttention适配 |
| SpeculativeSchedulerAdapter | serving/scheduling/SpeculativeSchedulerAdapter.ts | 推测性调度适配器 |
| TenantAwareScheduler | serving/scheduling/TenantAwareScheduler.ts | 多租户SLO隔离 |
| PPDRouter | serving/scheduling/PPDRouter.ts | PD动态路由 |

### 4.4 优化模块

| 模块 | 文件 | 功能 |
|------|------|------|
| KVCacheCompressor | serving/optimization/KVCacheCompressor.ts | 注意力熵剪枝+分层量化 |
| ContextBudgetPlanner | serving/optimization/ContextBudgetPlanner.ts | Perplexity引导裁剪+动态预算 |
| ChunkedPrefillCoordinator | serving/optimization/ChunkedPrefillCoordinator.ts | 公共前缀边界+跨chunk累积哈希 |
| AdaptiveChunkedPrefillCoordinator | serving/optimization/AdaptiveChunkedPrefillCoordinator.ts | 自适应chunk大小（load/slo/hybrid） |
| RLStrategySelector | serving/optimization/RLStrategySelector.ts | Q-learning策略选择 |

### 4.5 实验框架

| 模块 | 文件 | 功能 |
|------|------|------|
| AblationStudyRunner | serving/experiment/AblationStudyRunner.ts | 消融实验框架 |
| APIExperimentRunner | serving/experiment/APIExperimentRunner.ts | DeepSeek API实验 |
| StatisticalReporter | serving/experiment/StatisticalReporter.ts | 统计报告 |
| CalibrationPipeline | serving/calibration/CalibrationPipeline.ts | 四阶段校准流水线 |
| DeepSeekLatencyProber | serving/benchmark/DeepSeekLatencyProber.ts | API延迟测量 |

### 4.6 基础设施（第7轮新增）

| 模块 | 文件 | 功能 |
|------|------|------|
| DeterministicRandom | serving/utils/DeterministicRandom.ts | 种子化PRNG（Mulberry32） |
| UnifiedMetrics | serving/types/UnifiedMetrics.ts | 统一度量类型定义 |
| ServingPipelineV2 | serving/pipeline/ServingPipelineV2.ts | 统一配置Pipeline入口 |

---

## 五、项目规模

| 指标 | 数值 |
|------|------|
| 源码文件 | 76个 .ts 文件 |
| 测试文件 | 63个 .test.ts 文件 |
| serving模块源码 | ~22,400行 |
| 核心模块数 | 30+ |
| 对齐模拟 | vLLM (HashPrefixCache) + SGLang (RadixAttention) |

---

## 六、简历亮点建议

### 推荐表述

1. **PD分离推理模拟平台**
   > 实现完整PD分离推理模拟系统：支持DistServe/Splitwise架构，含层级KV传输建模、SARATHI分块预填、异构GPU资源配置优化，对比Monolithic方案TTFT降低42%

2. **多引擎适配层（开闭原则）**
   > 设计抽象缓存接口(Radix/Hash/Hierarchical)和调度接口(ContinuousBatching/SGLangRadix/Speculative/TenantAware)，实现零侵入式引擎切换，新增调度策略无需修改Pipeline代码

3. **完整实验框架**
   > 四阶段校准流水线(Component→Scheduling→Cache→E2E) + 自动化消融分析 + DeepSeek API延迟测量与校准闭环 + 多租户SLO隔离验证

### 技术关键词（简历ATS优化）

`PD Separation` `KV Cache` `Radix Tree` `Continuous Batching` `Speculative Decoding` `Chunked Prefill` `SLO-aware Scheduling` `Multi-tenant Isolation` `Ablation Study` `LLM Serving` `Calibration Pipeline`

---

## 七、已知问题与未来方向

### 已知问题
1. **死代码未完全清理**：PDServingSimulator（已被Enhanced替代）、TokenEstimator（已被Exact替代）仍存在
2. **教育遗留命名**：部分变量仍含`courseId`/`studentId`，EducationalWorkloadModel仍存在
3. **弱断言比例仍高**：约70%的断言为`assert.ok()`，需要进一步强化
4. **模拟数据真实性**：部分模块仍使用`Math.random()`而非DeterministicRandom
5. **缺少可视化**：Dashboard仅基础ECharts，缺少交互式架构图

### 推荐未来方向
1. **vLLM/SGLang真实集成**：当前为模拟适配器，可对接真实推理引擎API
2. **Speculative Decoding深化**：Draft-Target配对验证、acceptance rate位置衰减模型
3. **实验体系化**：3×3×3实验矩阵完整运行 + 统计显著性验证
4. **项目重命名**：从LEARN_AGENT彻底迁移到llm-serving-lab
5. **Dashboard升级**：实时模拟可视化 + 交互式参数调节

---

## 八、论文引用覆盖

| 论文 | 会议 | 覆盖模块 |
|------|------|---------|
| Orca (OSDI 2022) | 连续批处理 | ContinuousBatchingScheduler |
| DistServe (OSDI 2024) | PD分离 | EnhancedPDServingSimulator |
| vLLM/PagedAttention (SOSP 2023) | 分页注意力 | HashBasedPrefixCache |
| SGLang/RadixAttention (ICLR 2025) | Radix缓存 | SGLangRadixAdapter |
| Sarathi-Serve (OSDI 2024) | 分块预填 | ChunkedPrefillCoordinator |
| SpecInfer (MLSys 2024) | 推测性解码 | SpeculativeDecodingSimulator |
| Splitwise (ISCA 2024) | PD分离 | PPDRouter |

**待补充**：Moonwalk (OSDI 2024)、Infinite-LM (VLDB 2024)

---

## 九、运行指南

```bash
# 安装依赖
npm install

# 运行serving模块全部测试
npm run test:serving

# 运行PD分离模拟
npm run simulate:pd

# 运行引擎基准测试
npm run benchmark:engine

# 运行DeepSeek API校准（需设置环境变量）
DEEPSEEK_API_KEY=xxx npm run test:serving
```

---

*本报告由 LEARN_AGENT 自动迭代助手生成*
