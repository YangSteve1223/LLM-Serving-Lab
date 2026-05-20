import type { ChatMessage, LearningContext, LLMClient } from "../../src/agents/learningAssistant/index.ts";

export function aiThreeElementsContext(): LearningContext {
  return {
    material: { id: "demo", type: "pptx", title: "AI 基础", pageCount: 3 },
    outline: {
      source: "platform",
      items: [{ id: "outline-1", title: "人工智能三要素", pageStart: 1, pageEnd: 1 }]
    },
    currentPage: {
      id: "page-1",
      pageIndex: 1,
      semanticTitle: "人工智能三要素",
      title: "人工智能三要素",
      text: [
        "人工智能三要素",
        "数据是 AI 的知识来源。",
        "算法决定模型如何学习和推理。",
        "算力支撑模型训练和推理。",
        "三者缺一不可，需要相互支撑。"
      ].join("\n"),
      bulletPoints: ["数据", "算法", "算力"]
    },
    teacherScript: {
      source: "platform",
      text: "这一页强调数据、算法和算力不是孤立的。数据提供材料，算法提供方法，算力提供执行能力。"
    },
    learner: {
      id: "demo-learner",
      profile: { level: "beginner", language: "zh", stylePreference: "auto" },
      progress: { currentPageIndex: 1 }
    },
    chatHistory: []
  };
}

export function ragContext(): LearningContext {
  return {
    material: { id: "demo-rag", type: "pptx", title: "RAG", pageCount: 2 },
    currentPage: {
      id: "page-rag",
      pageIndex: 2,
      semanticTitle: "RAG vs LLM Wiki",
      title: "RAG vs LLM Wiki",
      text: "RAG 是临时查资料再生成，LLM Wiki 更像长期整理和沉淀知识。RAG 使用 query 检索 evidence，再注入 prompt 让 LLM generation。"
    },
    learner: {
      id: "demo-learner",
      profile: { level: "intermediate", language: "zh", stylePreference: "auto" }
    }
  };
}

export function qualityQuizLlm(): LLMClient {
  return {
    providerName: "unit-test-llm",
    modelName: "quality-fixture",
    async generate(messages: ChatMessage[]): Promise<string> {
      const prompt = messages.map((message) => message.content).join("\n");
      const wantsCompute = prompt.includes('"concept": "算力"') || prompt.includes("算力");
      const items = wantsCompute
        ? [computeItem(), dataItem(), algorithmItem()]
        : [dataItem(), algorithmItem(), computeItem()];
      return JSON.stringify({ items });
    }
  };
}

function dataItem() {
  return {
    id: "q-data",
    type: "concept_check",
    concept: "数据",
    learningObjective: "理解数据是 AI 的知识来源，决定模型知识边界。",
    question: "这页为什么说数据是 AI 的“知识来源”？请用一句话解释。",
    expectedAnswer: "数据为模型提供学习材料和知识来源，模型能学到什么受到数据内容、规模和质量的限制。",
    scoringRubric: {
      fullCredit: ["指出数据提供学习材料或知识来源", "说明数据会影响模型知识边界或训练效果"],
      partialCredit: ["只说出数据重要，但没有解释知识来源", "只提到规模或质量其中一点"],
      commonMistakes: ["认为数据质量不重要", "只说数据越多一定越好"]
    },
    hints: ["找当前页中“数据是 AI 的知识来源”这句话。"],
    difficulty: "easy",
    sourceEvidence: "数据是 AI 的知识来源。"
  };
}

function algorithmItem() {
  return {
    id: "q-algorithm",
    type: "application",
    concept: "算法",
    learningObjective: "理解算法决定模型如何学习和推理。",
    question: "如果只有数据但没有合适算法，模型学习会卡在哪里？",
    expectedAnswer: "数据只是材料，算法决定模型如何从数据中学习、推理和生成结果；没有合适算法，数据无法被有效利用。",
    scoringRubric: {
      fullCredit: ["说明算法决定如何学习和推理", "能区分数据是材料、算法是方法"],
      partialCredit: ["只说算法很重要", "只提到模型学习但没有说清机制"],
      commonMistakes: ["把算法说成算力", "认为有数据就能自动学会"]
    },
    hints: ["用“材料”和“方法”的区别来想。"],
    difficulty: "medium",
    sourceEvidence: "算法决定模型如何学习和推理。"
  };
}

function computeItem() {
  return {
    id: "q-compute",
    type: "misconception_check",
    concept: "算力",
    learningObjective: "理解算力是支撑训练和推理的计算资源，并区分算力和算法。",
    question: "有同学说“算力就是算法更聪明”。请根据当前页指出这句话哪里不对。",
    expectedAnswer: "这句话把算力和算法混淆了。算法决定模型如何学习和推理，算力是支撑训练和推理的计算资源，决定能不能做得动、做得快。",
    scoringRubric: {
      fullCredit: ["指出混淆了算力和算法", "说明算力是计算资源", "说明算法决定如何学习和推理"],
      partialCredit: ["能说出算力和算法不同", "只解释了算力或算法一方"],
      commonMistakes: ["算力就是算法更聪明", "把算力理解成算法"]
    },
    hints: ["当前页分别写了“算法决定”和“算力支撑”。"],
    difficulty: "medium",
    sourceEvidence: "算力支撑模型训练和推理。"
  };
}
