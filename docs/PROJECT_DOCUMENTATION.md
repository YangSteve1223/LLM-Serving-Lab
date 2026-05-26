# LEARN_AGENT — LLM Serving Lab 项目文档

> 面向长上下文场景的PD分离推理系统研究与模拟平台

## 项目定位

LEARN_AGENT 是一个纯 TypeScript 实现的 LLM Serving 研究平台，专注于**Prefill/Decode (PD) 分离架构**的模拟、基准测试与校准。无需 GPU，所有模块均可在 Node.js 环境下运行。

## 核心架构

```
Request → PromptBuilding → TokenEstimation → Scheduling → Simulation → TraceCollection → Report
```

### 模块总览

| 模块 | 文件数 | 代码行数 | 核心能力 |
|------|--------|----------|----------|
| **核心模拟器** | 12 | 3,618 | PD分离模拟、连续批调度、延迟验证 |
| **实验框架** | 11 | 6,294 | 3×3×3实验矩阵、消融研究、统计报告 |
| **优化** | 6 | 2,810 | 上下文预算规划、分块预填充、RL策略选择 |
| **缓存** | 8 | 2,884 | 层级KV缓存、前缀缓存、复用分析 |
| **引擎对接** | 14 | 2,698 | vLLM/SGLang指标适配、DeepSeek API集成 |
| **调度** | 7 | 1,911 | FCFS/SJF/SLO-aware、PPD路由、多租户隔离 |
| **推测解码** | 4 | 1,243 | n-gram/draft-target模拟、调度集成 |
| **对齐** | 4 | 1,473 | Hash缓存 vs Radix树对比、SGLang模拟 |
| **管道** | 2 | 615 | 请求处理管道、组件编排 |
| **工作负载** | 2 | 564 | 多模态负载建模、确定性随机 |
| **基准** | 2 | 476 | DeepSeek延迟探测、引擎基准 |
| **校准** | 2 | 579 | 四阶段校准闭环、反馈循环 |
| **类型** | 2 | 251 | 统一指标类型、公共接口 |
| **工具** | 3 | 233 | MathUtils(round/percentile)、确定性随机、哈希 |
| **总计** | **79** | **~25,649** | |

## 核心功能详解

### 1. PD 分离模拟 (`EnhancedPDServingSimulator`)
- 离散事件模拟 Prefill/Decode 分离架构
- 支持 KV Cache 跨节点传输建模
- 分块预填充 (SARATHI-style) 调度
- 输出完整的延迟分布 (P50/P90/P99)

### 2. 连续批调度 (`ContinuousBatchingScheduler`)
- 迭代级连续批处理
- FCFS / SJF / SLO-aware 三种调度策略
- 支持 chunked prefill 调度
- 多租户 SLO 隔离 (Gold/Silver/Bronze)

### 3. 层级 KV 缓存 (`HierarchicalKVCache`)
- L1 (GPU) → L2 (CPU) → L3 (Distributed) 三级缓存
- LRU/LFU/FLOP-aware 驱逐策略
- 跨层传输延迟建模
- 前缀感知缓存命中率优化

### 4. 推测解码模拟 (`SpeculativeDecodingSimulator`)
- n-gram 查找 & Draft-Target 对模拟
- 可配置的接受率与验证开销
- 与调度器集成的端到端流程

### 5. 引擎对接层
- **vLLM 指标适配**: 解析 Prometheus `/metrics` 端点
- **SGLang 指标适配**: 解析 Radix Attention 缓存指标
- **DeepSeek 适配器**: OpenAI-compatible streaming API，采集 TTFT/TPOT/E2E
- **模拟验证器**: 对比真实 API 延迟与模拟输出，自动校准

### 6. 实验框架
- **实验矩阵**: 3×3×3 (架构 × 缓存 × 调度) 完整组合
- **消融研究**: 逐步启用模块，测量增量改进
- **统计报告**: 均值/方差/置信区间/p-value
- **预定义实验**: 6个标准实验配置 (YAML)

### 7. 优化模块
- **上下文预算规划**: 动态分配 KV cache 预算
- **分块预填充协调**: SARATHI-style chunked prefill
- **RL 策略选择**: 基于状态的学习型策略切换

## 技术特点

### 确定性可重复
- `DeterministicRandom`: 种子化的随机数生成器，确保实验可重复
- 所有模拟参数使用共享常量 (`SIMULATION_CONSTANTS`)
- 统一的 `round()` / `percentile()` 工具函数

### 零外部依赖
- 纯 TypeScript + Node.js 原生 API
- 开发依赖仅有 `typescript`
- 无需 GPU 或特殊硬件

### 模拟精度校准
- 四阶段校准闭环: 采集 → 对比 → 校准 → 验证
- 支持 MAPE / SMAPE / MAE 误差指标
- 自动参数校准，目标 MAPE < 15%

## 快速开始

```bash
# 安装
npm install

# 运行所有 serving 测试
npm run test:serving

# 运行 PD 分离模拟
npm run simulate:pd

# 运行引擎基准测试
npm run benchmark:engine

# 使用 DeepSeek API 进行真实延迟测试
DEEPSEEK_API_KEY=your-key npx tsx scripts/real-engine-validation.ts
```

## 熵减优化记录

本次迭代完成了系统性代码精简：

| 优化项 | 减少行数 | 方法 |
|--------|----------|------|
| 提取 round()/percentile() 到 MathUtils | ~170 | 消除17处重复定义 |
| 统一 Magic Numbers 为常量 | ~80 | SIMULATION_CONSTANTS |
| 合并 ServingExperimentRunner → ExperimentMatrix | ~400 | 功能整合 |
| 替换自定义 gaussianRandom | ~10 | 复用 DeterministicRandom |
| 删除死代码与冗余模块 | ~50 | 清理未使用实现 |
| **总计** | **~710** | |

## 测试体系

- **50 个测试文件**，覆盖所有核心模块
- 使用 `node:test` + `node:assert/strict`
- 关键测试: PD模拟、调度策略、缓存驱逐、推测解码、引擎适配
- 所有测试通过 (0 failures)

## 项目结构

```
LEARN_AGENT/
├── src/agents/learningAssistant/serving/
│   ├── EnhancedPDServingSimulator.ts    # PD分离模拟器
│   ├── ContinuousBatchingScheduler.ts   # 连续批调度
│   ├── constants.ts                     # 共享常量
│   ├── alignment/                       # 对齐基准测试
│   ├── benchmark/                       # 延迟探测与基准
│   ├── cache/                           # KV缓存系统
│   ├── calibration/                     # 校准闭环
│   ├── engines/                         # 引擎对接与适配
│   ├── experiment/                      # 实验框架
│   ├── optimization/                    # 优化模块
│   ├── pipeline/                        # 请求管道
│   ├── scheduling/                      # 调度策略
│   ├── speculative/                     # 推测解码
│   ├── types/                           # 类型定义
│   ├── utils/                           # 工具函数
│   └── workload/                        # 工作负载建模
├── tests/serving/                       # 测试 (50 files)
├── configs/experiments/                 # 实验配置 (YAML)
├── scripts/                             # 实验脚本
├── docs/                                # 研究文档
└── reports/                             # 实验报告
```

## 后续方向

1. **GPU 集群验证**: 在真实 vLLM/SGLang 集群上验证模拟精度
2. **动态调度**: 基于实时指标的负载感知调度
3. **多模型支持**: 混合模型场景下的 PD 分离策略
4. **可视化面板**: 实时模拟仪表盘
5. **论文输出**: 基于3×3×3实验矩阵的研究论文
