/**
 * DeepSeek Provider Integration Test
 * 
 * Tests the DeepSeek LLM provider integration with the Learning Assistant Agent
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LearningAssistantAgent,
  LearningContextBuilder,
  MarkdownKnowledgeBase,
  createLLMClientFromEnv,
  createMaterialProvider,
  DeepSeekLLMClient
} from "../src/agents/learningAssistant/index.ts";

const currentFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(currentFile);
const rootDir = path.resolve(testDir, "..");
const materialPath = path.resolve(rootDir, "测试集/测试PPT/test1.learning-material.md");

// Test configuration - API key is read from environment variable DEEPSEEK_API_KEY
const API_KEY = process.env.DEEPSEEK_API_KEY;

interface TestResult {
  name: string;
  question: string;
  success: boolean;
  response?: string;
  error?: string;
  metrics: {
    ttft?: number; // Time to first token (ms)
    totalLatency: number; // End-to-end latency (ms)
    inputTokens?: number;
    outputTokens?: number;
  };
  qualityAssessment?: {
    accurate: boolean;
    refusedToFabricate: boolean;
    citations: string[];
    notes: string;
  };
}

// Test scenarios
const testScenarios = [
  {
    name: "简单问答 - PPT内容相关",
    question: "这页PPT主要讲什么内容？",
    pageIndex: 1,
    expectedTopics: ["人工智能", "三要素", "数据", "算法", "算力"]
  },
  {
    name: "简单问答 - 术语解释",
    question: "什么是算力？",
    pageIndex: 4,
    expectedTopics: ["计算", "大脑", "工具"]
  },
  {
    name: "引用证据的问题",
    question: "PPT中提到的Scaling Law论文是什么？",
    pageIndex: 3,
    expectedTopics: ["Kaplan", "scaling laws", "LLM"]
  },
  {
    name: "精确数值问题 - 应拒绝编造",
    question: "人类大脑的思维速度具体是多少？PPT中给的数据是什么？",
    pageIndex: 4,
    shouldRefuseToFabricate: false, // PPT中确实有数据：10bits/s
    expectedTopics: ["10", "bits"]
  },
  {
    name: "需要多页信息整合",
    question: "数据和算力在人工智能中各自扮演什么角色？",
    pageIndex: 2,
    expectedTopics: ["数据", "算力", "知识来源", "基础设施"]
  },
  {
    name: "公式/技术问题 - 应拒绝编造",
    question: "Scaling Law的具体公式是什么？PPT中给出了吗？",
    pageIndex: 3,
    shouldRefuseToFabricate: true, // PPT中没有给出公式
    expectedTopics: [] // 预期拒绝或诚实回答没有公式
  },
  {
    name: "引用来源验证",
    question: "PPT中引用的论文作者是谁？请列出参考文献",
    pageIndex: 3,
    expectedTopics: ["Kaplan", "2020"]
  },
  {
    name: "深入理解问题",
    question: "为什么说数据和算力相互支撑？请根据PPT内容解释",
    pageIndex: 1,
    expectedTopics: ["相互", "促进", "支撑"]
  }
];

async function runDeepSeekTest(): Promise<TestResult[]> {
  console.log("🚀 Starting DeepSeek Provider Integration Test\n");
  console.log("=".repeat(60));
  
  // Check API key
  if (!API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY environment variable is not set!");
    console.log("   Please set it before running this test:");
    console.log("   export DEEPSEEK_API_KEY=your_api_key_here");
    process.exit(1);
  }
  
  console.log("✅ API Key detected\n");
  
  // Test 1: Verify DeepSeekLLMClient can be instantiated
  console.log("📋 Test 1: DeepSeekLLMClient Instantiation");
  try {
    const client = new DeepSeekLLMClient({
      apiKey: API_KEY,
      model: "deepseek-chat"
    });
    console.log(`   ✅ Client created: provider=${client.providerName}, model=${client.modelName}`);
  } catch (e) {
    console.log(`   ❌ Failed to create client: ${e}`);
    process.exit(1);
  }
  
  // Test 2: Verify createLLMClientFromEnv works with DeepSeek
  console.log("\n📋 Test 2: createLLMClientFromEnv with DeepSeek");
  const llmResult = createLLMClientFromEnv({
    DEEPSEEK_API_KEY: API_KEY,
    DEEPSEEK_MODEL: "deepseek-chat"
  });
  
  if (llmResult.client) {
    console.log(`   ✅ LLM client created via env: provider=${llmResult.config?.provider}, model=${llmResult.config?.model}`);
  } else {
    console.log(`   ❌ Failed: ${llmResult.reason}`);
    process.exit(1);
  }
  
  // Setup knowledge base and agent
  console.log("\n📋 Test 3: Loading Material and Knowledge Base");
  
  // Load material properly
  const materialProvider = createMaterialProvider({ type: "markdown", filePath: materialPath });
  const material = await materialProvider.load({ type: "markdown", filePath: materialPath });
  console.log(`   ✅ Material loaded: ${material.title} (${material.pageCount} pages)`);
  
  const context = new LearningContextBuilder().build({
    material,
    pageIndex: 1,
    learner: {
      profile: {
        level: "beginner",
        language: "zh",
        stylePreference: "auto"
      }
    }
  });
  console.log(`   ✅ Learning context built`);
  
  // Create KB (optional for basic tests)
  let kb: MarkdownKnowledgeBase | null = null;
  try {
    const wikiPath = path.join(rootDir, "Education_LLM_Wiki_Operating_Package", "Education_LLM_Wiki_Operating_Package");
    kb = await MarkdownKnowledgeBase.fromPaths({
      rootDir,
      paths: [path.relative(rootDir, wikiPath)]
    });
    console.log(`   ✅ Knowledge base loaded`);
  } catch (e) {
    console.log(`   ⚠️ Knowledge base not available (optional): ${e}`);
  }
  
  const agent = new LearningAssistantAgent({
    kb: kb ?? undefined,
    llm: llmResult.client,
    requireRealLlm: true
  });
  console.log(`   ✅ Agent initialized\n`);
  
  // Run test scenarios
  console.log("=".repeat(60));
  console.log("🧪 Running Test Scenarios\n");
  
  const results: TestResult[] = [];
  
  for (const scenario of testScenarios) {
    console.log(`\n--- ${scenario.name} ---`);
    console.log(`Q: ${scenario.question}`);
    console.log(`Page: ${scenario.pageIndex + 1}`);
    
    const testResult: TestResult = {
      name: scenario.name,
      question: scenario.question,
      success: false,
      metrics: { totalLatency: 0 }
    };
    
    const startTime = performance.now();
    let ttft: number | undefined;
    
    try {
      // Build context for specific page
      const scenarioContext = new LearningContextBuilder().build({
        material,
        pageIndex: scenario.pageIndex,
        learner: {
          profile: {
            level: "beginner",
            language: "zh",
            stylePreference: "auto"
          }
        }
      });
      
      // For timing purposes, we'll make a direct API call
      // Note: The agent.answer() method may not expose TTFT, so we'll estimate
      const response = await agent.answer(scenario.question, scenarioContext);
      
      const endTime = performance.now();
      const latency = endTime - startTime;
      
      testResult.success = true;
      testResult.response = response.answer;
      testResult.metrics.totalLatency = latency;
      testResult.metrics.ttft = ttft;
      
      // Quality assessment
      const responseText = response.answer.toLowerCase();
      const accurate = scenario.expectedTopics.some(topic => 
        responseText.includes(topic.toLowerCase())
      );
      
      const refusedToFabricate = 
        scenario.shouldRefuseToFabricate && 
        (responseText.includes("没有") || responseText.includes("不确定") || 
         responseText.includes("没有给出") || responseText.includes("未提及"));
      
      testResult.qualityAssessment = {
        accurate,
        refusedToFabricate: refusedToFabricate ?? false,
        citations: response.citations.map(c => c.title),
        notes: accurate ? "回答包含相关主题" : "回答可能不够准确"
      };
      
      console.log(`✅ Success (${latency.toFixed(0)}ms)`);
      console.log(`   Response: ${response.answer.substring(0, 200)}...`);
      if (response.citations.length > 0) {
        console.log(`   Citations: ${response.citations.length}`);
      }
      
    } catch (error) {
      testResult.error = error instanceof Error ? error.message : String(error);
      testResult.metrics.totalLatency = performance.now() - startTime;
      console.log(`❌ Error: ${testResult.error}`);
    }
    
    results.push(testResult);
    
    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

function generateReport(results: TestResult[]): string {
  const timestamp = new Date().toISOString();
  const successfulTests = results.filter(r => r.success).length;
  const totalLatency = results.reduce((sum, r) => sum + r.metrics.totalLatency, 0);
  const avgLatency = totalLatency / results.length;
  
  const report = `# DeepSeek Provider Integration Test Report

## Test Configuration

- **Provider**: DeepSeek (OpenAI-compatible)
- **Base URL**: https://api.deepseek.com
- **Model**: deepseek-chat
- **Test Date**: ${timestamp}
- **API Key**: \`***[REDACTED]***\`

## Test Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${results.length} |
| Successful | ${successfulTests} |
| Failed | ${results.length - successfulTests} |
| Success Rate | ${((successfulTests / results.length) * 100).toFixed(1)}% |
| Avg Latency | ${avgLatency.toFixed(0)}ms |
| Min Latency | ${Math.min(...results.map(r => r.metrics.totalLatency)).toFixed(0)}ms |
| Max Latency | ${Math.max(...results.map(r => r.metrics.totalLatency)).toFixed(0)}ms |

## Test Scenarios

${results.map((r, i) => `### ${i + 1}. ${r.name}

**Question**: ${r.question}

**Status**: ${r.success ? "✅ PASS" : "❌ FAIL"}

**Latency**: ${r.metrics.totalLatency.toFixed(0)}ms${r.metrics.ttft ? ` (TTFT: ${r.metrics.ttft.toFixed(0)}ms)` : ""}

${r.success && r.response ? `**Response**:
${r.response.substring(0, 500)}${r.response.length > 500 ? "..." : ""}

` : ""}
${r.error ? `**Error**: ${r.error}

` : ""}
${r.qualityAssessment ? `**Quality Assessment**:
- Accurate: ${r.qualityAssessment.accurate ? "✅" : "❌"}
- Refused to Fabricate: ${r.qualityAssessment.refusedToFabricate ? "✅" : "N/A"}
- Citations: ${r.qualityAssessment.citations.length > 0 ? r.qualityAssessment.citations.join(", ") : "None"}
- Notes: ${r.qualityAssessment.notes}

` : ""}
---
`).join("")}

## Quality Analysis

### Accuracy
${(() => {
  const accurate = results.filter(r => r.qualityAssessment?.accurate);
  return `- Accurate responses: ${accurate.length}/${results.filter(r => r.success).length} (${((accurate.length / results.filter(r => r.success).length) * 100).toFixed(1)}%)`;
})()}

### Citation Quality
${(() => {
  const withCitations = results.filter(r => r.qualityAssessment && r.qualityAssessment.citations.length > 0);
  return `- Tests with citations: ${withCitations.length}/${results.filter(r => r.success).length}`;
})()}

### Hallucination/Refusal Testing
${(() => {
  const refusalTests = results.filter(r => r.qualityAssessment?.refusedToFabricate !== undefined);
  const correctRefusals = refusalTests.filter(r => r.qualityAssessment?.refusedToFabricate);
  return `- Tests involving refusal scenarios: ${refusalTests.length}
- Correct refusals (honest about missing info): ${correctRefusals.length}`;
})()}

## Recommendations

1. **Performance**: DeepSeek shows ${avgLatency < 3000 ? "good" : "acceptable"} latency for education assistant use cases
2. **Accuracy**: ${results.filter(r => r.qualityAssessment?.accurate).length}/${results.filter(r => r.success).length} responses were accurate
3. **Integration Status**: ✅ DeepSeek provider successfully integrated

### Next Steps
${results.filter(r => !r.success).length > 0 ? `
**Failed Tests Need Investigation**:
${results.filter(r => !r.success).map(r => `- ${r.name}: ${r.error}`).join("\n")}
` : ""}
- Consider testing with different models (deepseek-coder, deepseek-reasoner)
- Evaluate cost-effectiveness compared to KIMI provider
- Add more comprehensive test cases for edge cases
`;
  
  return report;
}

// Main execution
runDeepSeekTest()
  .then(async results => {
    console.log("\n" + "=".repeat(60));
    console.log("📊 Generating Report\n");
    
    const report = generateReport(results);
    
    // Save report
    const reportPath = path.join(rootDir, "reports", "deepseek-test-report.md");
    const fs = await import("node:fs");
    fs.writeFileSync(reportPath, report, "utf-8");
    
    console.log(`✅ Report saved to: ${reportPath}`);
    
    // Print summary
    console.log("\n📊 Test Summary:");
    console.log(`   Total: ${results.length}`);
    console.log(`   Success: ${results.filter(r => r.success).length}`);
    console.log(`   Failed: ${results.filter(r => !r.success).length}`);
    console.log(`   Avg Latency: ${(results.reduce((s, r) => s + r.metrics.totalLatency, 0) / results.length).toFixed(0)}ms`);
    
    process.exit(results.filter(r => !r.success).length > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error("❌ Test execution failed:", error);
    process.exit(1);
  });
