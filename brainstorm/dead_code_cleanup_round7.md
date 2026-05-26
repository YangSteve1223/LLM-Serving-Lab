# LEARN_AGENT 第7轮迭代：死代码与冗余清理报告

## 1. 死代码（从未被外部import的文件）

### 1.1 完全未使用的模块（只在index.ts导出，从未被其他模块引用）

| 文件路径 | 问题描述 | 建议清理方式 |
|---------|---------|-------------|
| `serving/PDServingSimulator.ts` | 旧版PD模拟器，仅被index.ts导出，从未被其他模块使用。`EnhancedPDServingSimulator`是其功能超集 | **删除** - 功能已被`EnhancedPDServingSimulator`完全替代 |
| `serving/SimulatorCalibrator.ts` | 模拟器校准工具，从未被import使用 | **删除** - 功能已被`CalibrationPipeline`整合 |
| `serving/PDDisaggregationVerifier.ts` | PD分离验证器，从未被其他模块使用 | **删除** - 属于实验性模块，无依赖 |
| `serving/PromptCanonicalizationPolicy.ts` | 提示规范化策略，从未被使用 | **合并到`CacheAwarePromptBuilder.ts`** - 功能相关 |
| `serving/PhaseTimer.ts` (41行) | 小型计时器，从未被导入 | **删除或合并** - 功能简单，可内联 |
| `serving/PromptComponentHasher.ts` (26行) | 哈希工具，但有`RequestTraceStore.ts`也有类似功能 | **合并到`RequestTraceStore.ts`** |
| `serving/ContextBudgetPlanner.ts` (176行) | 教育场景的上下文预算规划器，命名与`optimization/ContextBudgetPlanner.ts`冲突 | **重命名或合并** - 与PD serving优化模块功能重叠 |

### 1.2 仅被index.ts导出的实验性模块

| 文件路径 | 问题描述 | 建议清理方式 |
|---------|---------|-------------|
| `serving/cache/CacheExperimentRunner.ts` | 缓存实验运行器，从未被外部使用 | **保留但标记废弃** - 实验框架，可在AblationStudyRunner中替代 |
| `serving/benchmark/DeepSeekLatencyProber.ts` | DeepSeek延迟探测，从未被外部使用 | **合并到`CalibrationPipeline.ts`** |
| `serving/speculative/SpeculativeSchedulingIntegration.ts` | 推测调度集成，仅在speculative/index.ts导出 | **合并到`SpeculativeSchedulerAdapter.ts`** - 功能重叠 |
| `serving/alignment/AlignmentBenchmark.ts` | 对齐基准测试，从未被外部使用 | **删除** - 实验性模块 |

### 1.3 空目录

| 目录路径 | 问题描述 | 建议清理方式 |
|---------|---------|-------------|
| `serving/scheduler/` | **空目录** - 原计划目录但从未使用 | **删除整个目录** |

---

## 2. 冗余模块（功能重叠）

### 2.1 核心冗余

| 模块A | 模块B | 重叠说明 | 建议清理方式 |
|-------|-------|---------|-------------|
| `TokenEstimator.ts` | `ExactTokenEstimator.ts` | 两个token估计器，前者是简单估算，后者是精确BPE估算 | **保留ExactTokenEstimator**，删除`TokenEstimator.ts` |
| `ServingPipeline.ts` | `pipeline/ServingPipelineV2.ts` | V2是工厂模式版本，更灵活；旧版仅在index.ts导出 | **删除ServingPipeline.ts**，统一使用V2 |
| `workload/EducationalWorkloadModel.ts` | `workload/ServingWorkloadModel.ts` | **完全相同的代码**，仅文件名不同。`ServingWorkloadModel`是重命名版本 | **删除EducationalWorkloadModel.ts** |
| `ContextBudgetPlanner.ts` (根目录) | `optimization/ContextBudgetPlanner.ts` | **同名不同功能**：根目录是教育场景的，optimization是PD serving优化的 | **重命名根目录版本**为`GroundedContextPlanner.ts` |
| `speculative/SpeculativeSchedulingIntegration.ts` | `scheduling/SpeculativeSchedulerAdapter.ts` | 功能重叠：都负责推测调度的集成决策 | **合并到`SpeculativeSchedulerAdapter.ts`** |
| `speculative/SpeculativeDecodingSimulator.ts` | `scheduling/SpeculativeSchedulerAdapter.ts` | 前者是核心模拟器，后者是调度适配器 | **保留前者作为核心**，后者依赖前者是正确的 |

### 2.2 适配器冗余

| 模块 | 被使用情况 | 建议清理方式 |
|------|-----------|-------------|
| `scheduling/PPDRouter.ts` | 仅在scheduling/index.ts导出，从未被实际使用 | **删除或标记为废弃** |
| `scheduling/TenantAwareScheduler.ts` | 仅在scheduling/index.ts导出，从未使用 | **删除或标记为废弃** |

---

## 3. 教育遗留（命名/注释/变量仍含教育语义）

### 3.1 需要重命名的文件和类

| 当前路径/名称 | 建议新名称 | 原因 |
|--------------|-----------|------|
| `workload/ServingWorkloadModel.ts` | `SyntheticWorkloadModel.ts` | 去掉"Serving"前缀，更通用 |
| `workload/` 目录下的变量 | `SyntheticRequest` | 保留，但去掉`studentId`、`courseId`语义 |
| `tidalStrength` 参数 | `burstFactor` | 更通用的命名 |
| `courseMaterialTokens` | `sharedContextTokens` | 去掉教育场景语义 |

### 3.2 需要修改的注释/文档

| 文件 | 当前注释 | 建议修改 |
|------|---------|---------|
| `optimization/KVCacheCompressor.ts` | "Simulates attention patterns for educational content." | 修改为通用LLM serving描述 |
| `engines/EngineBenchmarkRunner.ts` | "You are a concise educational assistant." | 改为通用助手描述 |
| 所有教育相关的`@example` | 含学生/课程示例 | 改为通用请求示例 |

---

## 4. 过时API（接口改变但旧调用方式仍存在）

### 4.1 类型/接口兼容性问题

| 旧类型 | 新类型 | 遗留位置 |
|--------|--------|---------|
| `PDWorkloadRequest` | `EnhancedPDWorkloadRequest` | 部分模块仍在使用旧类型 |
| `CacheAwarePDSimulationResult` | 多处返回类型不一致 | 需要统一 |

### 4.2 环境变量/配置

| 配置项 | 状态 | 建议 |
|--------|------|------|
| `SERVING_PREFILL_MS_PER_TOKEN` | 仍在`PDServingSimulator.ts`中读取 | 迁移到`EnhancedPDServingSimulator.ts` |
| `SERVING_DECODE_MS_PER_TOKEN` | 同上 | 同上 |
| `SERVING_KV_MS_PER_TOKEN` | 同上 | 同上 |
| `PROMPT_CANONICALIZATION_MODE` | 仍在`PromptCanonicalizationPolicy.ts`中读取 | 合并到相关模块后删除该文件 |

---

## 5. 可合并的小文件

| 文件A | 文件B | 合并后文件名 | 理由 |
|-------|-------|-------------|------|
| `PromptComponentHasher.ts` (26行) | `RequestTraceStore.ts` (60行) | `HashUtils.ts` | 都是工具函数，可合并 |
| `PhaseTimer.ts` (41行) | 内联到使用它的地方 | - | 太简单，建议内联 |
| `PromptCanonicalizationPolicy.ts` (16行) | `CacheAwarePromptBuilder.ts` (158行) | `CacheAwarePromptBuilder.ts` | 功能相关，合并导出 |

---

## 6. 清理优先级建议

### 第一优先级（高风险/高收益）
1. **删除`PDServingSimulator.ts`** - 完全死代码
2. **删除`TokenEstimator.ts`** - 功能被`ExactTokenEstimator`完全替代
3. **删除`scheduler/`空目录**
4. **删除`EducationalWorkloadModel.ts`** - 与`ServingWorkloadModel.ts`完全重复

### 第二优先级（中风险/中收益）
5. **删除`SimulatorCalibrator.ts`** - 无使用
6. **删除`PromptCanonicalizationPolicy.ts`** - 可合并
7. **删除`PDDisaggregationVerifier.ts`** - 无使用
8. **重命名根目录`ContextBudgetPlanner.ts`** - 避免命名冲突

### 第三优先级（低风险/长期维护）
9. 更新`ServingWorkloadModel.ts`中的教育语义变量名
10. 更新所有文件的注释，去除教育相关描述
11. 统一`ServingPipeline.ts`到`ServingPipelineV2.ts`

---

## 总结统计

| 类别 | 数量 | 代码行数（估算） |
|------|------|----------------|
| 完全死代码（可删除） | 8-10个文件 | ~2000行 |
| 冗余模块（需合并） | 4-5对 | ~1500行 |
| 教育遗留（需重命名） | ~15处 | - |
| 空目录 | 1个 | - |

**总计可清理：约3500行代码，提升项目可维护性**
