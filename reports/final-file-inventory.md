# Final File Inventory

Generated at: 2026-05-20T06:51:30.530Z

## 1. Current Project Tree

```text
- 测试集/
  - 测试PPT/
    - 赵健凯-20220920-中期答辩.pptx
    - 最终_中期答辩.pptx
    - test1.pptx
    - test2.pptx
- docs/
  - competition-positioning.md
  - final-research-report.md
  - LEARN_AGENT_项目完整说明书.docx
  - LEARN_AGENT_项目完整说明书.md
  - learning-guide.md
  - pd-results.md
  - pd-serving-lab.md
  - sota-engine-bridge.md
- Education_LLM_Wiki_Operating_Package/
  - Education_LLM_Wiki_Operating_Package/
    - 00_Start_Here/
      - README.md
    - 01_Learning_Maps/
    - 02_Core_Concepts/
    - 03_Source_Notes/
    - 04_Insights/
    - 05_Query_Feedback/
      - Query_Inbox.md
    - 90_Raw_Sources/
    - 99_System/
      - Skills/
        - answer_query_and_writeback.md
        - compile_wiki_pages.md
        - ingest_and_parse_source.md
        - integrate_and_record.md
        - lint_and_repair_wiki.md
      - Templates/
        - Core_Concept_Template.md
        - Global_Frontmatter_Template.md
        - Index_Template.md
        - Insight_Template.md
        - Learning_Map_Template.md
        - Lint_Report_Template.md
        - Log_Template.md
        - Query_Feedback_Template.md
        - Source_Note_Template.md
      - Lint_Report.md
    - AGENTS.md
    - index.md
    - log.md
    - README_PACKAGE.md
- examples/
  - future-school-demo/
    - mock-students.json
    - run-future-school-demo.ts
  - learning-assistant-demo/
    - run-demo.ts
    - sample-material.md
  - learning-assistant-ui/
    - public/
      - assets/
        - future-school-demo-ui.png
      - app.js
      - competition.html
      - index.html
      - styles.css
    - server.ts
  - learning-loop-demo/
    - mock-class-session.json
    - README.md
    - run-learning-loop-demo.ts
- pptx2md/
  - pptx2md/
    - spec/
      - metadata_spec.md
      - metadata.example.json
      - metadata.schema.json
    - src/
      - pptx2md/
        - __pycache__/
        - extractors/
        - models/
        - normalizers/
        - renderers/
        - stats/
        - validators/
        - __init__.py
        - cli.py
    - tests/
      - samples/
      - test_batch_convert.py
      - test_media_consistency.py
      - test_smoke.py
    - README.md
    - requirements.txt
- release-screenshots/
  - competition-page.png
  - competition-values.png
  - learning-tools-drawer.png
  - README.md
  - student-demo-main.png
  - teacher-dashboard.png
- reports/
  - engine-benchmark.json
  - engine-benchmark.md
  - final-file-inventory.md
  - final-verification.json
  - final-verification.md
  - LEARN_AGENT_CODE_CONTEXT_FOR_AI.txt
  - pd-simulation.json
  - pd-simulation.md
- scripts/
  - capture-ui-screenshots.mjs
  - generate-code-context.js
  - generate-project-deliverables.js
  - pptx-to-markdown.ts
  - run-engine-benchmark.ts
  - run-evaluation.ts
  - run-kimi-evaluation.ts
  - run-pd-simulation.ts
  - verify-final-artifact.js
- src/
  - agents/
    - learningAssistant/
      - analysis/
        - QuestionAnalyzer.ts
      - context/
        - ContextAnalyzer.ts
        - LearningContextBuilder.ts
      - futureSchool/
        - FutureSchoolAgent.ts
        - index.ts
        - types.ts
      - grounding/
        - AnswerabilityChecker.ts
        - EvidenceSelector.ts
      - kb/
        - chunkMarkdown.ts
        - MarkdownKnowledgeBase.ts
        - retrieveChunks.ts
      - learner/
        - StudentModeler.ts
        - TeachingPolicyPlanner.ts
      - learningLoop/
        - index.ts
        - LearnerMemoryStore.ts
        - LearningActionPlanner.ts
        - LearningDiagnosisAgent.ts
        - LearningLoopAgent.ts
        - learningLoopUtils.ts
        - LearningObjectiveExtractor.ts
        - LLMQuizGenerator.ts
        - MicroQuizGenerator.ts
        - MisconceptionDetector.ts
        - QuizGrader.ts
        - QuizQualityChecker.ts
        - ReviewPlanner.ts
        - types.ts
      - llm/
        - createLLMClientFromEnv.ts
        - KimiLLMClient.ts
        - OpenAICompatibleLLMClient.ts
      - material/
        - inferOutlineFromDeck.ts
        - LearningMaterialProvider.ts
        - MarkdownMaterialProvider.ts
        - miniZip.ts
        - PowerPointComSlideRenderer.ts
        - PptxMarkdownBridge.ts
        - PptxMaterialProvider.ts
        - pptxToMarkdown.ts
        - providerFactory.ts
        - semanticTitle.ts
        - SlideRenderer.ts
        - TextMaterialProvider.ts
      - prompts/
        - answerPrompt.ts
        - assistantSystemPrompt.ts
      - reflection/
        - AnswerReflector.ts
      - resources/
        - adapters/
        - search/
        - index.ts
        - ResourceLibraryStore.ts
        - ResourceMatcher.ts
        - ResourceScoutAgent.ts
        - types.ts
      - serving/
        - engines/
        - CacheAwarePromptBuilder.ts
        - ContextBudgetPlanner.ts
        - index.ts
        - PDReportRenderer.ts
        - PDServingSimulator.ts
        - PhaseTimer.ts
        - PromptCanonicalizationPolicy.ts
        - PromptComponentHasher.ts
        - RequestTraceStore.ts
        - ServingTrace.ts
        - SimulatorCalibrator.ts
        - TokenEstimator.ts
      - skills/
        - KnowledgeRetrievalSkill.ts
        - SkillRegistry.ts
      - teacher/
        - ClassSessionStore.ts
        - index.ts
        - MisconceptionAggregator.ts
        - QuestionClusterer.ts
        - TeacherInsightAgent.ts
        - TeacherReportGenerator.ts
        - types.ts
      - index.ts
      - LearningAssistantAgent.ts
      - types.ts
- tests/
  - learning-loop/
    - diagnosis.test.ts
    - fixtures.ts
    - learner-memory.test.ts
    - micro-quiz-generation.test.ts
    - quiz-grading.test.ts
    - resource-scout.test.ts
    - review-planner.test.ts
    - teacher-insight.test.ts
    - ui-quality.test.ts
  - learningAssistant/
    - agent-flow.test.ts
    - concept-resolution.test.ts
    - context-awareness.test.ts
    - evaluator-stress.test.ts
    - quality-convergence.test.ts
    - slide-preview.test.ts
  - serving/
    - engine/
      - benchmark-report.test.ts
      - cache-aware-prompt-builder.test.ts
      - engine-metrics-adapter.test.ts
      - final-docs.test.ts
      - prometheus-metrics-parser.test.ts
      - sse-parser.test.ts
      - streaming-trace.test.ts
    - context-budget-planner.test.ts
    - pd-serving-simulator.test.ts
    - token-estimator.test.ts
    - trace-store.test.ts
  - TEST-2009/
    - assertions.ts
    - README.md
    - report-template.ts
    - run-test-2009.ts
    - TEST-2009.cases.json
    - TEST-2009.output-types.ts
    - TEST-2009.prompt.md
  - TEST-DEMO-UX/
    - videos/
    - README.md
    - run-test-demo-ux.ts
  - TEST-FUTURE-SCHOOL/
    - browser-profiles/
    - README.md
    - run-test-future-school.ts
  - TEST-LEARNING-LOOP-QUALITY/
    - screenshots/
    - run-test-learning-loop-quality.ts
- .gitignore
- package.json
- PORTABLE-README.md
- README.md
- tsconfig.json
```

## 2. Core Code Files

- src/agents/learningAssistant/LearningAssistantAgent.ts
- src/agents/learningAssistant/types.ts
- src/agents/learningAssistant/index.ts
- examples/learning-assistant-ui/server.ts
- src/agents/learningAssistant/serving/CacheAwarePromptBuilder.ts
- src/agents/learningAssistant/serving/ContextBudgetPlanner.ts
- src/agents/learningAssistant/serving/PDReportRenderer.ts
- src/agents/learningAssistant/serving/PDServingSimulator.ts
- src/agents/learningAssistant/serving/PhaseTimer.ts
- src/agents/learningAssistant/serving/PromptCanonicalizationPolicy.ts
- src/agents/learningAssistant/serving/PromptComponentHasher.ts
- src/agents/learningAssistant/serving/RequestTraceStore.ts
- src/agents/learningAssistant/serving/ServingTrace.ts
- src/agents/learningAssistant/serving/SimulatorCalibrator.ts
- src/agents/learningAssistant/serving/TokenEstimator.ts
- src/agents/learningAssistant/serving/engines/EngineBenchmarkRunner.ts
- src/agents/learningAssistant/serving/engines/EngineBenchmarkTypes.ts
- src/agents/learningAssistant/serving/engines/EngineMetricsClient.ts
- src/agents/learningAssistant/serving/engines/EngineProvider.ts
- src/agents/learningAssistant/serving/engines/PrometheusMetricsParser.ts
- src/agents/learningAssistant/serving/engines/SSEParser.ts
- src/agents/learningAssistant/serving/engines/SglangMetricsAdapter.ts
- src/agents/learningAssistant/serving/engines/StreamingOpenAICompatibleClient.ts
- src/agents/learningAssistant/serving/engines/StreamingTrace.ts
- src/agents/learningAssistant/serving/engines/VllmMetricsAdapter.ts
- src/agents/learningAssistant/serving/index.ts
- scripts/run-pd-simulation.ts
- scripts/run-engine-benchmark.ts
- scripts/verify-final-artifact.js
- scripts/generate-code-context.js
- scripts/generate-project-deliverables.js

## 3. Core Documents

- docs/LEARN_AGENT_项目完整说明书.docx
- docs/LEARN_AGENT_项目完整说明书.md
- docs/competition-positioning.md
- docs/final-research-report.md
- docs/learning-guide.md
- docs/pd-results.md
- docs/pd-serving-lab.md
- docs/sota-engine-bridge.md

## 4. Generated Reports

- reports/LEARN_AGENT_CODE_CONTEXT_FOR_AI.txt
- reports/engine-benchmark.json
- reports/engine-benchmark.md
- reports/final-file-inventory.md
- reports/final-verification.json
- reports/final-verification.md
- reports/pd-simulation.json
- reports/pd-simulation.md

## 5. Test Files

- tests/TEST-2009/README.md
- tests/TEST-2009/TEST-2009.cases.json
- tests/TEST-2009/TEST-2009.output-types.ts
- tests/TEST-2009/TEST-2009.prompt.md
- tests/TEST-2009/assertions.ts
- tests/TEST-2009/report-template.ts
- tests/TEST-2009/run-test-2009.ts
- tests/TEST-DEMO-UX/README.md
- tests/TEST-DEMO-UX/run-test-demo-ux.ts
- tests/TEST-FUTURE-SCHOOL/README.md
- tests/TEST-FUTURE-SCHOOL/run-test-future-school.ts
- tests/TEST-LEARNING-LOOP-QUALITY/run-test-learning-loop-quality.ts
- tests/learning-loop/diagnosis.test.ts
- tests/learning-loop/fixtures.ts
- tests/learning-loop/learner-memory.test.ts
- tests/learning-loop/micro-quiz-generation.test.ts
- tests/learning-loop/quiz-grading.test.ts
- tests/learning-loop/resource-scout.test.ts
- tests/learning-loop/review-planner.test.ts
- tests/learning-loop/teacher-insight.test.ts
- tests/learning-loop/ui-quality.test.ts
- tests/learningAssistant/agent-flow.test.ts
- tests/learningAssistant/concept-resolution.test.ts
- tests/learningAssistant/context-awareness.test.ts
- tests/learningAssistant/evaluator-stress.test.ts
- tests/learningAssistant/quality-convergence.test.ts
- tests/learningAssistant/slide-preview.test.ts
- tests/serving/context-budget-planner.test.ts
- tests/serving/engine/benchmark-report.test.ts
- tests/serving/engine/cache-aware-prompt-builder.test.ts
- tests/serving/engine/engine-metrics-adapter.test.ts
- tests/serving/engine/final-docs.test.ts
- tests/serving/engine/prometheus-metrics-parser.test.ts
- tests/serving/engine/sse-parser.test.ts
- tests/serving/engine/streaming-trace.test.ts
- tests/serving/pd-serving-simulator.test.ts
- tests/serving/token-estimator.test.ts
- tests/serving/trace-store.test.ts

## 6. Temporary / Cache / Old Snapshot Candidates

- None

## 7. Suggested Move List

- No obvious cleanup candidates found.

## 8. Move Rationale

| Path Pattern | Reason | Risk | Restore |
| --- | --- | --- | --- |
| .cache/ | Runtime slide-preview cache regenerated by tests/UI. | low | Move the folder back to project root. |
| reports/pptx2md-cache/ | Generated conversion cache, not source. | low | Move the folder back to reports/. |
| tests/serving-output/ | JSONL output from trace-store tests. | low | Move the folder back to tests/. |
| old TEST-* logs/snapshots | Historical run evidence duplicated by final reports. | low/medium | Move the directory back to tests/. |

## 9. Latest Cleanup Manifest

Latest manifest: 删除审查区/final_cleanup_20260520_141736/MOVE_MANIFEST.md

﻿# Move Manifest

Created at: 2026-05-20 14:17:36 +08:00

| Original Path | New Path | Reason | Risk | Restore |
| --- | --- | --- | --- | --- |
| .cache | 删除审查区\final_cleanup_20260520_141736\.cache | Runtime slide preview cache regenerated by tests/UI | low | Move $new back to $orig. |
| reports\pptx2md-cache | 删除审查区\final_cleanup_20260520_141736\reports_pptx2md-cache | Generated PPTX conversion cache, not source | low | Move $new back to $orig. |
| reports\docx-render-check | 删除审查区\final_cleanup_20260520_141736\reports_docx-render-check | Internal DOCX render QA PNGs, final DOCX/MD remain in docs | low | Move $new back to $orig. |
| tests\serving-output | 删除审查区\final_cleanup_20260520_141736\tests_serving-output | Trace-store test JSONL output regenerated by tests | low | Move $new back to $orig. |
| tests\20260520-134355-FINAL-FREEZE-VERIFY | 删除审查区\final_cleanup_20260520_141736\tests_20260520-134355-FINAL-FREEZE-VERIFY | Previous final-freeze log snapshot superseded by current final verification reports | low | Move $new back to $orig. |
| tests\TEST-20260520-122027-PD-SERVING-LAB | 删除审查区\final_cleanup_20260520_141736\tests_TEST-20260520-122027-PD-SERVING-LAB | Historical PD lab run logs and old snapshots duplicated by current reports | low | Move $new back to $orig. |
| tests\TEST-20260520-130729-SOTA-ENGINE-BRIDGE | 删除审查区\final_cleanup_20260520_141736\tests_TEST-20260520-130729-SOTA-ENGINE-BRIDGE | Historical engine bridge run logs and old benchmark snapshots with outdated Goodput wording | low | Move $new back to $orig. |
| scripts\verify-final-artifact.ts | 删除审查区\final_cleanup_20260520_141736\scripts_verify-final-artifact.ts | Superseded by scripts/verify-final-artifact.js and no longer referenced by package scripts | low | Move $new back to $orig. |
| .cache | 删除审查区\final_cleanup_20260520_141736\.cache_after-final-verify | Runtime slide preview cache regenerated by final verification tests | low | Move $new back to $orig. |
| tests\serving-output | 删除审查区\final_cleanup_20260520_141736\tests_serving-output_after-final-verify | Trace-store JSONL output regenerated by final verification tests | low | Move $new back to $orig. |
| reports\docx-render-check | 删除审查区\final_cleanup_20260520_141736\reports_docx-render-check_after-final-verify | Internal DOCX render QA PNGs after visual verification | low | Move $new back to $orig. |
| reports\pptx2md-cache | 删除审查区\final_cleanup_20260520_141736\reports_pptx2md-cache_after-final-verify | PPTX conversion cache regenerated by final verification tests | low | Move $new back to $orig. |
| .cache | 删除审查区\final_cleanup_20260520_141736\.cache_after-final-verify-2 | Runtime slide preview cache regenerated by final verification rerun | low | Move $new back to $orig. |
| tests\serving-output | 删除审查区\final_cleanup_20260520_141736\tests_serving-output_after-final-verify-2 | Trace-store JSONL output regenerated by final verification rerun | low | Move $new back to $orig. |
| reports\pptx2md-cache | 删除审查区\final_cleanup_20260520_141736\reports_pptx2md-cache_after-final-verify-2 | PPTX conversion cache regenerated by final verification rerun | low | Move $new back to $orig. |
| tests\learning-loop\.tmp-memory | 删除审查区\final_cleanup_20260520_141736\tests_learning-loop_.tmp-memory_learning-loop-temp | Temporary learning-loop unit-test output; tests recreate it if needed. | low | Move back to $srcRel. |
| tests\learning-loop\.tmp-resource-library | 删除审查区\final_cleanup_20260520_141736\tests_learning-loop_.tmp-resource-library_learning-loop-temp | Temporary learning-loop unit-test output; tests recreate it if needed. | low | Move back to $srcRel. |


No files are deleted by the cleanup process; moved files are kept under the deletion review area.
