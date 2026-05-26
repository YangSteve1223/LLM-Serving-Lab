/**
 * DeepSeek API Cache Impact Test
 * 
 * Tests the impact of prefix caching on real DeepSeek API calls.
 * Records TTFT, token consumption, and generates a test report.
 * 
 * IMPORTANT: API key is read from environment variable, never hardcoded!
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Get API key from environment
const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-chat";

// Verify API key
if (!API_KEY) {
  console.error("Error: DEEPSEEK_API_KEY environment variable is not set!");
  console.error("Please set it with: export DEEPSEEK_API_KEY=<your-api-key>");
  process.exit(1);
}

interface TestRequest {
  id: string;
  scenario: string;
  prompt: string;
  isSharedPrefix: boolean;
}

interface TestResult {
  requestId: string;
  scenario: string;
  success: boolean;
  ttftMs: number;
  totalTimeMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  error?: string;
}

// Educational scenarios with shared system prompt
const educationalScenarios: TestRequest[] = [
  {
    id: "scenario_1_math_question",
    scenario: "Math Question - Course A",
    prompt: `You are a math tutor. Explain the solution to: What is the derivative of x^2 + 3x - 5?`,
    isSharedPrefix: true
  },
  {
    id: "scenario_2_math_followup",
    scenario: "Math Follow-up - Course A",
    prompt: `You are a math tutor. Explain the solution to: What is the derivative of x^2 + 3x - 5? Then find the critical points.`,
    isSharedPrefix: true
  },
  {
    id: "scenario_3_math_new",
    scenario: "Math Question - Course B",
    prompt: `You are a math tutor. Explain: What is the integral of 2x dx?`,
    isSharedPrefix: false
  },
  {
    id: "scenario_4_history_question",
    scenario: "History Question - Course C",
    prompt: `You are a history teacher. Explain: What were the main causes of World War I?`,
    isSharedPrefix: true
  },
  {
    id: "scenario_5_history_followup",
    scenario: "History Follow-up - Course C",
    prompt: `You are a history teacher. Explain: What were the main causes of World War I? Also describe the assassination that triggered it.`,
    isSharedPrefix: true
  },
  {
    id: "scenario_6_physics_question",
    scenario: "Physics Question - Course D",
    prompt: `You are a physics tutor. Explain: What is Newton's second law of motion?`,
    isSharedPrefix: true
  },
  {
    id: "scenario_7_physics_followup",
    scenario: "Physics Follow-up - Course D",
    prompt: `You are a physics tutor. Explain: What is Newton's second law of motion? Calculate the force on a 5kg object accelerating at 2m/s^2.`,
    isSharedPrefix: true
  },
  {
    id: "scenario_8_science_new",
    scenario: "Science Question - Course E",
    prompt: `You are a science teacher. Explain: What is the structure of an atom?`,
    isSharedPrefix: false
  },
  {
    id: "scenario_9_code_question",
    scenario: "Coding Question - Course F",
    prompt: `You are a programming instructor. Explain: How do you implement a binary search in Python?`,
    isSharedPrefix: true
  },
  {
    id: "scenario_10_code_followup",
    scenario: "Coding Follow-up - Course F",
    prompt: `You are a programming instructor. Explain: How do you implement a binary search in Python? Show the time complexity analysis.`,
    isSharedPrefix: true
  }
];

// System prompt (shared prefix)
const SHARED_SYSTEM_PROMPT = `You are an AI teaching assistant for an online learning platform. Your role is to:
- Provide clear, educational explanations
- Use examples to illustrate concepts
- Break down complex topics into simpler steps
- Be patient and encouraging

Always maintain a friendly and supportive tone.`;

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

async function callDeepSeekAPI(prompt: string): Promise<{
  success: boolean;
  ttftMs: number;
  totalTimeMs: number;
  completion: string;
  promptTokens: number;
  completionTokens: number;
  error?: string;
}> {
  const promptTokens = estimateTokens(SHARED_SYSTEM_PROMPT) + estimateTokens(prompt);
  
  const startTime = Date.now();
  let firstTokenTime = startTime;
  let completionText = "";

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SHARED_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        ttftMs: 0,
        totalTimeMs: Date.now() - startTime,
        completion: "",
        promptTokens,
        completionTokens: 0,
        error: `API Error ${response.status}: ${errorText}`
      };
    }

    if (!response.body) {
      return {
        success: false,
        ttftMs: 0,
        totalTimeMs: Date.now() - startTime,
        completion: "",
        promptTokens,
        completionTokens: 0,
        error: "No response body"
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.choices?.[0]?.delta?.content) {
              if (firstTokenTime === startTime) {
                firstTokenTime = Date.now();
              }
              completionText += parsed.choices[0].delta.content;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    const completionTokens = estimateTokens(completionText);

    return {
      success: true,
      ttftMs: firstTokenTime - startTime,
      totalTimeMs: Date.now() - startTime,
      completion: completionText,
      promptTokens,
      completionTokens
    };
  } catch (error) {
    return {
      success: false,
      ttftMs: 0,
      totalTimeMs: Date.now() - startTime,
      completion: "",
      promptTokens,
      completionTokens: 0,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  console.log("Starting DeepSeek API Cache Impact Tests...\n");
  console.log(`API: ${BASE_URL}`);
  console.log(`Model: ${MODEL}`);
  console.log(`System prompt tokens: ~${estimateTokens(SHARED_SYSTEM_PROMPT)}\n`);

  for (const scenario of educationalScenarios) {
    console.log(`Running: ${scenario.scenario}...`);
    
    const result = await callDeepSeekAPI(scenario.prompt);
    
    results.push({
      requestId: scenario.id,
      scenario: scenario.scenario,
      success: result.success,
      ttftMs: result.ttftMs,
      totalTimeMs: result.totalTimeMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.promptTokens + result.completionTokens,
      error: result.error
    });

    if (result.success) {
      console.log(`  ✓ TTFT: ${result.ttftMs}ms, Tokens: ${result.totalTokens}`);
    } else {
      console.log(`  ✗ Error: ${result.error}`);
    }

    // Rate limiting - wait between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

function analyzeResults(results: TestResult[]): {
  summary: Record<string, any>;
  cacheImpact: {
    sharedPrefixTTFTAvg: number;
    newPrefixTTFTAvg: number;
    ttftImprovement: number;
    ttftImprovementPercent: number;
  };
  tokenStats: {
    avgPromptTokens: number;
    avgCompletionTokens: number;
    avgTotalTokens: number;
  };
  requestBreakdown: Array<{
    scenario: string;
    ttftMs: number;
    tokens: number;
    isSharedPrefix: boolean;
    success: boolean;
    error?: string;
  }>;
} {
  const successfulResults = results.filter(r => r.success);
  const sharedPrefixResults = successfulResults.filter(r => 
    educationalScenarios.find(s => s.id === r.requestId)?.isSharedPrefix
  );
  const newPrefixResults = successfulResults.filter(r => 
    !educationalScenarios.find(s => s.id === r.requestId)?.isSharedPrefix
  );

  const sharedPrefixTTFTAvg = sharedPrefixResults.reduce((sum, r) => sum + r.ttftMs, 0) / Math.max(1, sharedPrefixResults.length);
  const newPrefixTTFTAvg = newPrefixResults.reduce((sum, r) => sum + r.ttftMs, 0) / Math.max(1, newPrefixResults.length);

  const avgPromptTokens = successfulResults.reduce((sum, r) => sum + r.promptTokens, 0) / Math.max(1, successfulResults.length);
  const avgCompletionTokens = successfulResults.reduce((sum, r) => sum + r.completionTokens, 0) / Math.max(1, successfulResults.length);
  const avgTotalTokens = successfulResults.reduce((sum, r) => sum + r.totalTokens, 0) / Math.max(1, successfulResults.length);

  return {
    summary: {
      totalRequests: results.length,
      successfulRequests: successfulResults.length,
      failedRequests: results.length - successfulResults.length,
      successRate: `${((successfulResults.length / results.length) * 100).toFixed(1)}%`
    },
    cacheImpact: {
      sharedPrefixTTFTAvg: Math.round(sharedPrefixTTFTAvg),
      newPrefixTTFTAvg: Math.round(newPrefixTTFTAvg),
      ttftImprovement: Math.round(newPrefixTTFTAvg - sharedPrefixTTFTAvg),
      ttftImprovementPercent: newPrefixTTFTAvg > 0 
        ? Math.round(((newPrefixTTFTAvg - sharedPrefixTTFTAvg) / newPrefixTTFTAvg) * 100) 
        : 0
    },
    tokenStats: {
      avgPromptTokens: Math.round(avgPromptTokens),
      avgCompletionTokens: Math.round(avgCompletionTokens),
      avgTotalTokens: Math.round(avgTotalTokens)
    },
    requestBreakdown: results.map(r => ({
      scenario: r.scenario,
      ttftMs: r.ttftMs,
      tokens: r.totalTokens,
      isSharedPrefix: educationalScenarios.find(s => s.id === r.requestId)?.isSharedPrefix ?? false,
      success: r.success,
      error: r.error
    }))
  };
}

function generateReport(testResults: TestResult[], analysis: ReturnType<typeof analyzeResults>): string {
  const report = `# DeepSeek API Cache Impact Test Report

## Test Configuration
- **API Endpoint:** ${BASE_URL}
- **Model:** ${MODEL}
- **Test Date:** ${new Date().toISOString()}
- **System Prompt Tokens:** ~${estimateTokens(SHARED_SYSTEM_PROMPT)}

## Summary
- **Total Requests:** ${analysis.summary.totalRequests}
- **Successful Requests:** ${analysis.summary.successfulRequests}
- **Failed Requests:** ${analysis.summary.failedRequests}
- **Success Rate:** ${analysis.summary.successRate}

## Cache Impact Analysis

### TTFT (Time to First Token) Comparison
| Metric | Value |
|--------|-------|
| Average TTFT (Shared Prefix) | ${analysis.cacheImpact.sharedPrefixTTFTAvg}ms |
| Average TTFT (New Prefix) | ${analysis.cacheImpact.newPrefixTTFTAvg}ms |
| TTFT Improvement | ${analysis.cacheImpact.ttftImprovement}ms |
| Improvement Percentage | ${analysis.cacheImpact.ttftImprovementPercent}% |

### Token Statistics
| Metric | Value |
|--------|-------|
| Average Prompt Tokens | ${analysis.tokenStats.avgPromptTokens} |
| Average Completion Tokens | ${analysis.tokenStats.avgCompletionTokens} |
| Average Total Tokens | ${analysis.tokenStats.avgTotalTokens} |

## Detailed Request Results

| # | Scenario | Shared Prefix | TTFT (ms) | Tokens | Status |
|---|----------|---------------|-----------|--------|--------|
${analysis.requestBreakdown.map((r, i) => 
  `| ${i + 1} | ${r.scenario} | ${r.isSharedPrefix ? "✓" : "✗"} | ${r.ttftMs} | ${r.tokens} | ${r.success ? "✓ Success" : "✗ " + (r.error || "Unknown")} |`
).join("\n")}

## Key Findings

### Cache Efficiency
${analysis.cacheImpact.ttftImprovementPercent > 0 
  ? `The test shows that requests with shared system prompts benefit from caching, with an average TTFT improvement of **${analysis.cacheImpact.ttftImprovementPercent}%** for subsequent requests with the same prefix.`
  : `The TTFT improvement was minimal. This may be due to:
- DeepSeek's internal caching implementation
- Network latency being the dominant factor
- Test sample size being too small`}

### Recommendations
1. **Use consistent system prompts** across similar request types to maximize cache hits
2. **Batch related requests** together to leverage prefix sharing
3. **Monitor cache hit rates** in production environments
4. **Consider prompt optimization** to reduce unique prefixes while maintaining quality

## Notes
- API key is read from \`DEEPSEEK_API_KEY\` environment variable (not stored in this report)
- TTFT measurements may include network latency
- Results are based on a single test run and may vary

---
*Generated by CacheExperimentRunner DeepSeek Test*
`;

  return report;
}

// Main execution
async function main() {
  console.log("=".repeat(60));
  console.log("DeepSeek API Cache Impact Test");
  console.log("=".repeat(60));

  const results = await runTests();
  const analysis = analyzeResults(results);
  const report = generateReport(results, analysis);

  // Save report
  const reportPath = "reports/cache-deepseek-test.md";
  writeFileSync(reportPath, report, "utf-8");
  console.log(`\n✓ Report saved to: ${reportPath}`);

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Test Summary");
  console.log("=".repeat(60));
  console.log(`Total Requests: ${analysis.summary.totalRequests}`);
  console.log(`Successful: ${analysis.summary.successfulRequests}`);
  console.log(`Success Rate: ${analysis.summary.successRate}`);
  console.log(`\nCache Impact:`);
  console.log(`  Shared Prefix Avg TTFT: ${analysis.cacheImpact.sharedPrefixTTFTAvg}ms`);
  console.log(`  New Prefix Avg TTFT: ${analysis.cacheImpact.newPrefixTTFTAvg}ms`);
  console.log(`  TTFT Improvement: ${analysis.cacheImpact.ttftImprovement}ms (${analysis.cacheImpact.ttftImprovementPercent}%)`);
}

main().catch(console.error);
