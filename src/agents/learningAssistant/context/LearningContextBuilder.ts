import { summarizePage } from "../material/inferOutlineFromDeck.ts";
import type {
  AnswerStylePreference,
  LearningContext,
  LearningMaterial,
  LearningOutline,
  LearningPage,
  TeacherScript
} from "../types.ts";

export type BuildLearningContextInput = {
  material: LearningMaterial;
  pageIndex: number;
  platformOutline?: LearningOutline;
  platformTeacherScript?: TeacherScript;
  learner?: LearningContext["learner"];
  chatHistory?: LearningContext["chatHistory"];
  platformMetadata?: Record<string, unknown>;
  stylePreference?: AnswerStylePreference;
};

export class LearningContextBuilder {
  build(input: BuildLearningContextInput): LearningContext {
    const currentPage = getPage(input.material, input.pageIndex);
    const previous = input.material.pages.find((page) => page.pageIndex === currentPage.pageIndex - 1);
    const next = input.material.pages.find((page) => page.pageIndex === currentPage.pageIndex + 1);
    const outline = input.platformOutline ?? input.material.outline ?? { source: "missing", items: [] };
    const teacherScript = buildTeacherScript(currentPage, input.platformTeacherScript);
    const currentPageSummary = currentPage.text.trim()
      ? { source: "auto_summary" as const, text: summarizePage(currentPage, 180) }
      : undefined;
    const learner = mergeStylePreference(input.learner, input.stylePreference);

    return {
      material: {
        id: input.material.id,
        type: input.material.type,
        title: input.material.title,
        filePath: input.material.filePath,
        pageCount: input.material.pageCount,
        metadata: input.material.metadata
      },
      outline,
      currentPage,
      neighborPages: {
        previous: previous ? toNeighbor(previous) : undefined,
        next: next ? toNeighbor(next) : undefined
      },
      teacherScript,
      currentPageSummary,
      learner,
      chatHistory: input.chatHistory,
      platformMetadata: {
        ...input.platformMetadata,
        contextBuilder: "LearningContextBuilder"
      }
    };
  }
}

function getPage(material: LearningMaterial, pageIndex: number): LearningPage {
  const page = material.pages.find((item) => item.pageIndex === pageIndex);
  if (!page) throw new Error(`Page ${pageIndex} is out of range for material ${material.title ?? material.id}`);
  return page;
}

function buildTeacherScript(page: LearningPage, platformTeacherScript?: TeacherScript): TeacherScript {
  if (platformTeacherScript?.text || (platformTeacherScript?.segments?.length ?? 0) > 0) {
    return platformTeacherScript;
  }
  if (page.speakerNotes?.trim()) {
    return {
      source: "speaker_notes",
      text: page.speakerNotes,
      segments: [{ pageId: page.id, pageIndex: page.pageIndex, text: page.speakerNotes }]
    };
  }
  return { source: "missing" };
}

function toNeighbor(page: LearningPage) {
  return {
    pageIndex: page.pageIndex,
    title: page.semanticTitle ?? page.title,
    summary: summarizePage(page, 120)
  };
}

function mergeStylePreference(
  learner: LearningContext["learner"],
  stylePreference?: AnswerStylePreference
): LearningContext["learner"] {
  if (!stylePreference) return learner;
  return {
    ...learner,
    profile: {
      ...learner?.profile,
      stylePreference
    }
  };
}
