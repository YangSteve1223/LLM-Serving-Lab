import assert from "node:assert/strict";
import test from "node:test";
import { LearningAssistantAgent } from "../../src/agents/learningAssistant/index.ts";
import type { LearningContext } from "../../src/agents/learningAssistant/types.ts";

test("concept reference resolution filters slide template noise", async () => {
  const context: LearningContext = {
    currentPage: {
      id: "fusion-slide-5",
      pageIndex: 5,
      title: "JILIN UNIVERSITY 中期答辩 05 面向检测的联合优化：当前主线方案",
      semanticTitle: "面向检测的联合优化：当前主线方案",
      text: [
        "JILIN UNIVERSITY 中期答辩 05 面向检测的联合优化：当前主线方案",
        "核心思路 将优化重点进一步转移到检测目标上。",
        "融合网络直接为检测器服务，而不是只追求视觉层面的看起来更好。",
        "使用全新的融合层策略 softmax-weighted。",
        "最终以系统级检测指标 mAP 和 F1 作为主判断依据。"
      ].join("\n"),
      bulletPoints: ["softmax-weighted 融合", "mAP/F1 检测指标", "YOLO 检测任务"]
    }
  };

  const response = await new LearningAssistantAgent().answer("除了当前 PPT，这个概念在知识库里有没有更完整的解释？", context);
  const combined = [response.answer, response.citations.map((citation) => citation.textPreview ?? "").join("\n")].join("\n");

  assert.match(response.answer, /面向检测的联合优化/);
  assert.doesNotMatch(combined, /\bJILIN\b/i);
  assert.doesNotMatch(combined, /\bUNIVERSITY\b/i);
  assert.doesNotMatch(response.answer, /中期答辩.*候选|当前页还可能涉及.*中期答辩/);
  assert.match(response.answer, /外部知识库|知识库/);
});

test("current page citations are deduplicated", async () => {
  const context: LearningContext = {
    currentPage: {
      id: "page-1",
      pageIndex: 1,
      title: "人工智能三要素",
      semanticTitle: "人工智能三要素",
      text: "人工智能三要素\n数据是知识来源。\n算法决定模型能力。\n算力支撑训练和推理。",
      bulletPoints: ["数据", "算法", "算力"]
    },
    teacherScript: {
      source: "platform",
      text: "教师讲稿：本页强调数据、算法、算力缺一不可。"
    }
  };

  const response = await new LearningAssistantAgent().answer("这页主要讲什么？", context);
  const currentPageKeys = response.citations
    .filter((citation) => citation.sourceType === "current_page")
    .map((citation) => `${citation.sourceType}|${citation.pageIndex}|${citation.semanticTitle ?? citation.title ?? ""}`);

  assert.equal(new Set(currentPageKeys).size, currentPageKeys.length);
});
