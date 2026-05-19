const state = {
  files: [],
  material: null,
  page: null,
  context: null,
  pageIndex: 1,
  exampleQuestions: [],
  messages: [],
  latestResponse: null,
  config: null,
  uiMode: initialMode(),
  activeQuiz: null,
  learningLoopTab: "quiz"
};

const els = {
  appShell: document.querySelector("#appShell"),
  topMaterialLine: document.querySelector("#topMaterialLine"),
  modelSettingsToggle: document.querySelector("#modelSettingsToggle"),
  settingsOverlay: document.querySelector("#settingsOverlay"),
  modelSettingsPanel: document.querySelector("#modelSettingsPanel"),
  closeModelSettings: document.querySelector("#closeModelSettings"),
  modeToggle: document.querySelector("#modeToggle"),
  materialSelect: document.querySelector("#materialSelect"),
  filePathInput: document.querySelector("#filePathInput"),
  loadButton: document.querySelector("#loadButton"),
  learnerLevel: document.querySelector("#learnerLevel"),
  stylePreference: document.querySelector("#stylePreference"),
  llmProvider: document.querySelector("#llmProvider"),
  llmApiKey: document.querySelector("#llmApiKey"),
  llmModel: document.querySelector("#llmModel"),
  llmBaseUrl: document.querySelector("#llmBaseUrl"),
  resourceSearchProvider: document.querySelector("#resourceSearchProvider"),
  tavilyApiKey: document.querySelector("#tavilyApiKey"),
  bingSearchApiKey: document.querySelector("#bingSearchApiKey"),
  serpApiKey: document.querySelector("#serpApiKey"),
  groundingMode: document.querySelector("#groundingMode"),
  requireRealLlm: document.querySelector("#requireRealLlm"),
  llmStatus: document.querySelector("#llmStatus"),
  modeStatus: document.querySelector("#modeStatus"),
  confidenceStatus: document.querySelector("#confidenceStatus"),
  skillStatus: document.querySelector("#skillStatus"),
  pageCounter: document.querySelector("#pageCounter"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  goPage: document.querySelector("#goPage"),
  zoomSlide: document.querySelector("#zoomSlide"),
  openPageTextDrawer: document.querySelector("#openPageTextDrawer"),
  pageIndexInput: document.querySelector("#pageIndexInput"),
  pageNotice: document.querySelector("#pageNotice"),
  slidePreviewStatus: document.querySelector("#slidePreviewStatus"),
  slidePreview: document.querySelector("#slidePreview"),
  pageTitle: document.querySelector("#pageTitle"),
  pageText: document.querySelector("#pageText"),
  pageMarkdown: document.querySelector("#pageMarkdown"),
  pageMarkdownDrawer: document.querySelector("#pageMarkdownDrawer"),
  pageTextOverlay: document.querySelector("#pageTextOverlay"),
  pageTextDrawer: document.querySelector("#pageTextDrawer"),
  closePageTextDrawer: document.querySelector("#closePageTextDrawer"),
  quickPromptsToggle: document.querySelector("#quickPromptsToggle"),
  quickPromptsPopover: document.querySelector("#quickPromptsPopover"),
  developerStressPanel: document.querySelector("#developerStressPanel"),
  questionList: document.querySelector("#questionList"),
  testQuestionList: document.querySelector("#testQuestionList"),
  learningToolsToggle: document.querySelector("#learningToolsToggle"),
  openQuizShortcut: document.querySelector("#openQuizShortcut"),
  learningToolsOverlay: document.querySelector("#learningToolsOverlay"),
  learningToolsDrawer: document.querySelector("#learningToolsDrawer"),
  closeLearningTools: document.querySelector("#closeLearningTools"),
  loopStageLabel: document.querySelector("#loopStageLabel"),
  loopNextAction: document.querySelector("#loopNextAction"),
  sessionReportButton: document.querySelector("#sessionReportButton"),
  generateQuizButton: document.querySelector("#generateQuizButton"),
  memoryButton: document.querySelector("#memoryButton"),
  resourcesButton: document.querySelector("#resourcesButton"),
  teacherButton: document.querySelector("#teacherButton"),
  learningToolTabs: document.querySelectorAll("[data-loop-tab]"),
  learningLoopOutput: document.querySelector("#learningLoopOutput"),
  askForm: document.querySelector("#askForm"),
  queryInput: document.querySelector("#queryInput"),
  askButton: document.querySelector("#askButton"),
  chatWindow: document.querySelector("#chatWindow"),
  llmHint: document.querySelector("#llmHint"),
  evidenceDetails: document.querySelector("#evidenceDetails"),
  debugPanel: document.querySelector("#debugPanel"),
  citationSummary: document.querySelector("#citationSummary"),
  generationBox: document.querySelector("#generationBox"),
  answerabilityBox: document.querySelector("#answerabilityBox"),
  traceBox: document.querySelector("#traceBox"),
  policyBox: document.querySelector("#policyBox"),
  usedContext: document.querySelector("#usedContext"),
  skillList: document.querySelector("#skillList"),
  selectedEvidenceList: document.querySelector("#selectedEvidenceList"),
  rejectedEvidenceList: document.querySelector("#rejectedEvidenceList"),
  citationList: document.querySelector("#citationList"),
  rawResponseBox: document.querySelector("#rawResponseBox"),
  slideModal: document.querySelector("#slideModal"),
  slideModalImage: document.querySelector("#slideModalImage"),
  closeSlideModal: document.querySelector("#closeSlideModal")
};

await bootstrap();

els.modelSettingsToggle.addEventListener("click", () => openModelSettings());
els.closeModelSettings.addEventListener("click", () => closeModelSettings());
els.settingsOverlay.addEventListener("click", () => closeModelSettings());
els.modeToggle.addEventListener("click", () => setMode(state.uiMode === "demo" ? "developer" : "demo"));
els.loadButton.addEventListener("click", () => loadSelectedMaterial());
els.materialSelect.addEventListener("change", () => {
  const file = state.files.find((item) => item.filePath === els.materialSelect.value);
  if (file) els.filePathInput.value = file.filePath;
});
els.prevPage.addEventListener("click", () => goToPage(state.pageIndex - 1));
els.nextPage.addEventListener("click", () => goToPage(state.pageIndex + 1));
els.goPage.addEventListener("click", () => goToPage(Number(els.pageIndexInput.value)));
els.zoomSlide.addEventListener("click", openSlideModal);
els.slidePreview.addEventListener("click", openSlideModal);
els.openPageTextDrawer.addEventListener("click", () => openPageTextDrawer());
els.closePageTextDrawer.addEventListener("click", () => closePageTextDrawer());
els.pageTextOverlay.addEventListener("click", () => closePageTextDrawer());
els.closeSlideModal.addEventListener("click", () => els.slideModal.close());
els.quickPromptsToggle.addEventListener("click", () => {
  els.quickPromptsPopover.hidden = !els.quickPromptsPopover.hidden;
  els.quickPromptsToggle.classList.toggle("is-active", !els.quickPromptsPopover.hidden);
});
document.addEventListener("click", (event) => {
  if (els.askForm.contains(event.target)) return;
  closeQuickPrompts();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeQuickPrompts();
  closeModelSettings();
  closePageTextDrawer();
  closeLearningToolsDrawer();
});
els.learningToolsToggle.addEventListener("click", () => openLearningToolsDrawer("quiz"));
els.openQuizShortcut.addEventListener("click", () => generateMicroQuiz());
els.closeLearningTools.addEventListener("click", () => closeLearningToolsDrawer());
els.learningToolsOverlay.addEventListener("click", () => closeLearningToolsDrawer());
els.sessionReportButton.addEventListener("click", () => loadSessionReport());
els.learningToolTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.loopTab ?? "quiz";
    if (tab === "quiz") return openLearningToolsDrawer("quiz");
    if (tab === "memory") return loadLearnerMemory();
    if (tab === "resources") return recommendResources();
    if (tab === "teacher") return loadTeacherInsight();
  });
});
els.generateQuizButton.addEventListener("dblclick", () => generateMicroQuiz());
els.askForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await ask(els.queryInput.value);
});
els.queryInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await ask(els.queryInput.value);
  }
});
[els.llmApiKey, els.llmModel, els.llmBaseUrl, els.llmProvider, els.requireRealLlm, els.resourceSearchProvider, els.tavilyApiKey, els.bingSearchApiKey, els.serpApiKey].forEach((element) => {
  element.addEventListener("input", updateRuntimeStatus);
  element.addEventListener("change", updateRuntimeStatus);
});

async function bootstrap() {
  setMode(state.uiMode);
  setBusy(true, "正在加载");
  try {
    const config = await api("/api/config");
    state.config = config;
    state.files = config.files ?? [];
    state.exampleQuestions = config.exampleQuestions ?? [];
    els.requireRealLlm.checked = Boolean(config.llm?.requireRealLlmForDemo);
    renderFileOptions();
    renderQuestions();
    updateRuntimeStatus();
    if (state.files[0]) {
      els.filePathInput.value = state.files[0].filePath;
      await loadSelectedMaterial();
    } else {
      renderSlidePreview(undefined, "没有发现可加载的 PPT 或 Markdown。");
    }
  } catch (error) {
    showNotice(`初始化失败：${messageOf(error)}`, true);
  } finally {
    setBusy(false);
  }
}

function initialMode() {
  const param = new URLSearchParams(window.location.search).get("mode");
  if (param === "developer" || param === "demo") return param;
  return "demo";
}

function setMode(mode) {
  state.uiMode = mode;
  localStorage.setItem("learningAssistantUiMode", mode);
  document.body.dataset.mode = mode;
  els.appShell.dataset.mode = mode;
  els.modeToggle.textContent = mode === "demo" ? "开发模式" : "演示模式";
  els.modeToggle.classList.toggle("is-active", mode === "developer");
  els.debugPanel.open = mode === "developer";
  if (mode === "demo") closeModelSettings();
  closeQuickPrompts();
  renderQuestions();
}

function renderFileOptions() {
  els.materialSelect.innerHTML = "";
  if (state.files.length === 0) {
    const option = document.createElement("option");
    option.textContent = "未发现 .pptx/.md 文件";
    option.value = "";
    els.materialSelect.append(option);
    return;
  }
  for (const file of state.files) {
    const option = document.createElement("option");
    option.value = file.filePath;
    option.textContent = file.name;
    els.materialSelect.append(option);
  }
}

function renderQuestions() {
  const demoPrompts = [
    "这页主要讲什么？",
    "这页最重要的概念是什么？",
    "给我一个检查理解的小问题",
    "这里最容易混淆的点是什么？",
    "请用生活类比解释这页",
    "我学完这页应该记住什么？"
  ];
  const developerStressQuestions = [
    "请给出 AlphaBetaZeta-927 的具体公式、数值推导和预算表。",
    "当前页是人工智能三要素，请问火星基地供氧预算表怎么推导？",
    "RAG 和普通 LLM 问答有什么区别？",
    "除了当前 PPT，这个概念在知识库里有没有更完整的解释？"
  ];
  fillPromptList(els.questionList, demoPrompts);
  if (state.uiMode === "developer") {
    fillPromptList(els.testQuestionList, developerStressQuestions);
    els.developerStressPanel.hidden = false;
  } else {
    els.testQuestionList.innerHTML = "";
    els.developerStressPanel.hidden = true;
  }
}
function fillPromptList(container, questions) {
  container.innerHTML = "";
  for (const question of questions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = question;
    button.addEventListener("click", () => {
      els.queryInput.value = question;
      els.queryInput.focus();
      closeQuickPrompts();
    });
    container.append(button);
  }
}

function closeQuickPrompts() {
  els.quickPromptsPopover.hidden = true;
  els.quickPromptsToggle.classList.remove("is-active");
}

function openModelSettings() {
  els.modelSettingsPanel.hidden = false;
  els.settingsOverlay.hidden = false;
  els.modelSettingsToggle.classList.add("is-active");
}

function closeModelSettings() {
  els.modelSettingsPanel.hidden = true;
  els.settingsOverlay.hidden = true;
  els.modelSettingsToggle.classList.remove("is-active");
}

function openPageTextDrawer() {
  els.pageTextDrawer.hidden = false;
  els.pageTextOverlay.hidden = false;
}

function closePageTextDrawer() {
  els.pageTextDrawer.hidden = true;
  els.pageTextOverlay.hidden = true;
}

function openLearningToolsDrawer(tab = "quiz", options = {}) {
  els.learningToolsDrawer.hidden = false;
  els.learningToolsOverlay.hidden = false;
  setLearningToolsTab(tab, options);
}

function closeLearningToolsDrawer() {
  els.learningToolsDrawer.hidden = true;
  els.learningToolsOverlay.hidden = true;
}

function setLearningToolsTab(tab = "quiz", options = {}) {
  state.learningLoopTab = tab;
  els.learningToolTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.loopTab === tab);
  });
  if (options.keepContent) return;
  if (tab === "quiz") renderQuizIntro();
  if (tab === "memory") showLoopPanel('<div class="loop-empty"><h3>学习记忆</h3><p>正在准备学习记忆视图…</p></div>');
  if (tab === "resources") showLoopPanel('<div class="loop-empty"><h3>推荐资源</h3><p>正在准备资源推荐视图…</p></div>');
  if (tab === "teacher") showLoopPanel('<div class="loop-empty"><h3>教师视图</h3><p>正在准备教师洞察视图…</p></div>');
}

function renderQuizIntro(message) {
  const llmReady = hasUsableLlm();
  showLoopPanel(`
    <div class="loop-empty">
      <h3>本页小测</h3>
      <p>${escapeHtml(message ?? (llmReady ? "点击“生成本页小测”，我会根据当前 PPT 页生成 2-3 道检查理解的小题。" : "生成高质量小测需要连接真实模型。请先在“模型设置”中配置 API Key。"))}</p>
      <button type="button" class="drawer-generate-quiz-button" ${llmReady ? "" : "disabled"}>生成本页小测</button>
      <button type="button" class="drawer-session-report-button">生成本页学习报告</button>
    </div>
  `);
  bindDrawerQuizButtons();
}

function bindDrawerQuizButtons() {
  els.learningLoopOutput.querySelectorAll(".drawer-generate-quiz-button").forEach((button) => {
    button.addEventListener("click", () => generateMicroQuiz());
  });
  els.learningLoopOutput.querySelectorAll(".drawer-session-report-button").forEach((button) => {
    button.addEventListener("click", () => loadSessionReport());
  });
}

async function loadSelectedMaterial() {
  const filePath = els.filePathInput.value.trim();
  if (!filePath) return;
  setBusy(true, "加载中");
  renderSlidePreview(undefined, "正在加载学习材料……");
  showNotice("正在加载课件，稍等一下。");
  try {
    const payload = await api("/api/load-material", { filePath, pageIndex: 1 });
    applyMaterialPayload(payload, { resetMessages: true });
    showNotice("材料已加载，下一次提问会基于第 1 页。", false, true);
  } catch (error) {
    renderSlidePreview(undefined, `加载失败：${messageOf(error)}`);
    showNotice(`加载失败：${messageOf(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function goToPage(pageIndex) {
  if (!state.material) return;
  const bounded = Math.min(Math.max(1, pageIndex), state.material.pageCount);
  setBusy(true, "切页中");
  try {
    const payload = await api("/api/page", {
      materialId: state.material.id,
      pageIndex: bounded
    });
    applyMaterialPayload(payload, { resetMessages: false });
    showNotice(`已切换到第 ${bounded} 页，下一次提问会基于这一页。`, false, true);
  } catch (error) {
    showNotice(`切页失败：${messageOf(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function ask(query) {
  const trimmed = query.trim();
  if (!trimmed || !state.material) return;
  if (isRealLlmRequiredButMissing()) {
    showNotice("Require real LLM 已打开。请先在“模型设置”里填写 API Key，或关闭该开关。", true);
    updateRuntimeStatus();
    return;
  }

  const questionPageIndex = state.pageIndex;
  const questionPageTitle = currentPageTitle();
  state.messages.push({
    role: "user",
    content: trimmed,
    pageIndex: questionPageIndex,
    pageTitle: questionPageTitle
  });
  renderChat();
  els.queryInput.value = "";
  setBusy(true, "思考中…");

  try {
    const response = await api("/api/ask", {
      materialId: state.material.id,
      pageIndex: questionPageIndex,
      query: trimmed,
      learnerLevel: els.learnerLevel.value,
      stylePreference: els.stylePreference.value,
      groundingMode: els.groundingMode.value,
      requireRealLlm: els.requireRealLlm.checked,
      llmProvider: els.llmProvider.value,
      llmApiKey: els.llmApiKey.value.trim(),
      llmModel: els.llmModel.value.trim(),
      llmBaseUrl: els.llmBaseUrl.value.trim()
    });
    state.latestResponse = response;
    state.messages.push({
      role: "assistant",
      content: response.answer ?? "",
      response,
      pageIndex: questionPageIndex,
      pageTitle: questionPageTitle
    });
    renderChat();
    renderDebug(response);
    updateRuntimeStatus(response);
    updateLoopProgress("answered_question");
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `提问失败：${messageOf(error)}`,
      error: true,
      pageIndex: questionPageIndex,
      pageTitle: questionPageTitle
    });
    renderChat();
    showNotice(`提问失败：${messageOf(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function generateMicroQuiz() {
  if (!state.material) return showNotice("请先加载学习材料。", true);
  if (!hasUsableLlm()) {
    showNotice("当前未连接真实模型，无法生成高质量小测。", true);
    openLearningToolsDrawer("quiz", { keepContent: false });
    return;
  }
  openLearningToolsDrawer("quiz", { keepContent: true });
  setLoopBusy("正在生成小测…");
  try {
    const payload = await api("/api/learning-loop/generate-quiz", {
      materialId: state.material.id,
      pageIndex: state.pageIndex,
      learnerId: "demo-learner",
      learnerLevel: els.learnerLevel.value,
      count: 3,
      llmProvider: els.llmProvider.value,
      llmApiKey: els.llmApiKey.value.trim(),
      llmModel: els.llmModel.value.trim(),
      llmBaseUrl: els.llmBaseUrl.value.trim()
    });
    state.activeQuiz = payload.quiz;
    renderQuiz(payload.quiz);
    updateLoopProgress("quiz_generated");
  } catch (error) {
    renderLoopError(error);
  }
}

async function loadLearnerMemory() {
  openLearningToolsDrawer("memory", { keepContent: true });
  setLoopBusy("正在读取学习记忆…");
  try {
    const [payload, conceptPayload] = await Promise.all([
      api("/api/learning-loop/memory/demo-learner"),
      state.material
        ? api("/api/learning-loop/concept-map", {
            materialId: state.material.id,
            pageIndex: state.pageIndex,
            learnerId: "demo-learner",
            learnerLevel: els.learnerLevel.value
          })
        : Promise.resolve({ conceptMap: undefined })
    ]);
    const memory = payload.memory;
    showLoopPanel(`
      <h3>学习记忆</h3>
      ${renderConceptMap(conceptPayload.conceptMap)}
      <div class="loop-columns">
        <div><strong>已掌握概念</strong><p>${escapeHtml((memory.masteredConcepts ?? []).join("、") || "暂无")}</p></div>
        <div><strong>薄弱概念</strong><p>${escapeHtml((memory.weakConcepts ?? []).join("、") || "暂无")}</p></div>
      </div>
      <h4>常见误区</h4>
      ${renderLoopList((memory.misconceptions ?? []).map((item) => `${item.concept}: ${item.description}（${item.count} 次）`))}
      <h4>复习任务</h4>
      ${renderLoopList((memory.reviewTasks ?? []).map((item) => `${item.concept} · ${item.taskType} · ${new Date(item.dueAt).toLocaleDateString()}`))}
    `);
  } catch (error) {
    renderLoopError(error);
  }
}

async function recommendResources() {
  if (!state.material) return showNotice("请先加载学习材料。", true);
  openLearningToolsDrawer("resources", { keepContent: true });
  setLoopBusy("正在匹配学习资源…");
  try {
    const payload = await api("/api/resources/tasks", {
      materialId: state.material.id,
      pageIndex: state.pageIndex,
      learnerId: "demo-learner",
      learnerLevel: els.learnerLevel.value,
      preferredDurationMinutes: 15,
      ...resourceSearchPayload()
    });
    const cards = (payload.tasks ?? []).map((item) => `
      <article class="loop-card">
        <strong>${escapeHtml(item.title)}</strong>
        <p><span>类型：</span>${escapeHtml(item.type ?? "article")} · <span>来源：</span>${escapeHtml(item.sourceName ?? "未知")} · <span>可信度：</span>${escapeHtml(item.credibility ?? "medium")} · <span>是否已验证：</span>${item.verified ? "是" : "否"}</p>
        ${item.url ? `<p><a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a></p>` : ""}
        <p><span>推荐理由：</span>${escapeHtml(item.reason)}</p>
        <p><span>学习目标：</span>${escapeHtml(item.learningGoal ?? "补强当前页薄弱概念")}</p>
        <p><span>建议学习目标：</span>${escapeHtml(item.suggestedSegment ? `${item.suggestedSegment.start}-${item.suggestedSegment.end}` : item.suggestedFocus ?? "重点关注解释当前概念与课件证据关系的部分。")}</p>
        <p><span>看前问题：</span>${escapeHtml(item.beforeTaskQuestion ?? "")}</p>
        <p><span>看后检查题：</span>${escapeHtml(item.afterTaskQuestion ?? "")}</p>
        <p><span>关联薄弱点：</span>${escapeHtml(item.linkedWeakConcept ?? "当前页概念")}</p>
      </article>
    `);
    const statusText = resourceStatusText(payload);
    const debug = state.uiMode === "developer" ? `<details><summary>resource search debug</summary><pre class="material-text compact">${escapeHtml(JSON.stringify(payload.debug ?? {}, null, 2))}</pre></details>` : "";
    showLoopPanel(`
      <h3>推荐学习任务</h3>
      <p class="loop-muted">搜索状态：${escapeHtml(statusText)}</p>
      ${cards.join("") || '<p class="empty">当前未配置资源搜索服务，也没有教师导入资源库，无法推荐可靠资源。</p>'}
      ${debug}
    `);
  } catch (error) {
    renderLoopError(error);
  }
}

async function loadTeacherInsight() {
  openLearningToolsDrawer("teacher", { keepContent: true });
  setLoopBusy("正在生成教师洞察…");
  try {
    const [payload, afterClassPayload, wikiPayload] = await Promise.all([
      api("/api/teacher/insights", teacherConfigPayload()),
      api("/api/teacher/after-class-report", {}),
      api("/api/wiki/writeback-suggestion", { learnerId: "demo-learner" })
    ]);
    const dashboard = payload.dashboardReport;
    const suggestion = wikiPayload.suggestion;
    showLoopPanel(`
      <h3>教师看板</h3>
      ${renderTeacherConfigForm(dashboard)}
      <p class="loop-muted">数据来源：${escapeHtml(readableTeacherDataSource(dashboard?.dataSource))}</p>
      <p class="loop-muted">${escapeHtml(payload.dataSourceNotice ?? "当前为 Demo 班级数据，仅用于演示。")}</p>
      <div class="loop-columns">
        <article class="loop-card"><strong>学生数</strong><p>${escapeHtml(dashboard?.overview?.studentCount ?? dashboard?.classSize ?? 0)}</p></article>
        <article class="loop-card"><strong>问题数</strong><p>${escapeHtml(dashboard?.overview?.totalQuestions ?? 0)}</p></article>
        <article class="loop-card"><strong>小测次数</strong><p>${escapeHtml(dashboard?.overview?.totalQuizAttempts ?? 0)}</p></article>
        <article class="loop-card"><strong>高风险概念</strong><p>${escapeHtml(dashboard?.overview?.highRiskConceptCount ?? 0)}</p></article>
      </div>
      <h4>共性困惑</h4>
      ${(dashboard?.commonConfusions ?? []).map((item) => `
        <article class="loop-card">
          <strong>${escapeHtml(item.concept)} · ${escapeHtml(item.severity)}</strong>
          <p>影响学生数：${escapeHtml(item.studentCount)}</p>
          <p>代表性匿名问题：${escapeHtml((item.evidenceExamples ?? []).join("；") || "暂无")}</p>
          <p>建议教师怎么讲：${escapeHtml(item.suggestedTeacherAction)}</p>
        </article>
      `).join("") || '<p class="empty">暂无</p>'}
      <h4>薄弱概念排行</h4>
      ${renderLoopList((dashboard?.weakConceptRanking ?? []).map((item) => `${item.concept}: ${item.count}`))}
      <h4>建议 5 分钟 mini lesson</h4>
      ${renderLoopList((dashboard?.suggestedMiniLessons ?? []).map((item) => `${item.title} · ${item.durationMinutes} 分钟 · ${item.suggestedActivity}`))}
      <h4>建议课堂即时检查题</h4>
      ${renderLoopList((dashboard?.suggestedQuizQuestions ?? []).map((item) => `${item.question}（${item.difficulty}）`))}
      <h4>推荐教师补充资源</h4>
      ${renderLoopList((dashboard?.resourceSuggestionsForTeacher ?? []).map((item) => `${item.title ?? item.resource?.title}: ${item.url ?? item.resource?.url}`))}
      <h4>建议沉淀到知识库</h4>
      ${(dashboard?.knowledgeBaseWritebackSuggestions ?? []).map((item) => `
        <article class="loop-card">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.reason)}</p>
          <p>建议类型：${escapeHtml(item.suggestedEntryType)}</p>
        </article>
      `).join("") || '<p class="empty">暂无</p>'}
      <h4>知识库改进建议</h4>
      <article class="loop-card">
        <strong>${suggestion.shouldWriteBack ? "建议补充知识库" : "暂不需要写回"}</strong>
        <p>${escapeHtml(suggestion.reason)}</p>
        ${suggestion.suggestedEntry ? `<p>${escapeHtml(suggestion.suggestedEntry.title)}：${escapeHtml(suggestion.suggestedEntry.content)}</p>` : ""}
      </article>
      <details><summary>导出教师报告 Markdown</summary><pre class="material-text compact">${escapeHtml(payload.markdown ?? "")}</pre></details>
      <details><summary>导出教师报告 JSON</summary><pre class="material-text compact">${escapeHtml(JSON.stringify(dashboard ?? {}, null, 2))}</pre></details>
      ${state.uiMode === "developer" ? `<details><summary>raw teacher JSON</summary><pre class="material-text compact">${escapeHtml(JSON.stringify(dashboard ?? {}, null, 2))}</pre></details>` : ""}
    `);
  } catch (error) {
    renderLoopError(error);
  }
}

function renderQuiz(quiz) {
  const items = (quiz.questions ?? []).map((question, index) => `
    <article class="loop-card" data-question-id="${escapeHtml(question.id)}">
      <strong>${index + 1}. ${escapeHtml(question.question)}</strong>
      <p class="loop-muted">概念：${escapeHtml(question.concept)} · 难度：${escapeHtml(question.difficulty)}</p>
      <button type="button" class="hint-button">提示</button>
      <p class="quiz-hint" hidden>${escapeHtml((question.hints ?? []).join("；") || "回到当前页证据中找关键词。")}</p>
      <textarea class="quiz-answer" rows="2" placeholder="在这里写你的回答"></textarea>
      <button type="button" class="grade-quiz-button" data-question-id="${escapeHtml(question.id)}">提交答案</button>
      <div class="grade-result"></div>
      ${state.uiMode === "developer" ? renderQuizDeveloperDetails(question) : ""}
    </article>
  `);
  const qualityLine = state.uiMode === "developer" && quiz.quality
    ? `<p class="loop-muted">qualityScore: ${escapeHtml(String(quiz.quality.score))} · ${escapeHtml((quiz.quality.issues ?? []).join("；") || "passed")}</p>`
    : "";
  showLoopPanel(`<h3>${escapeHtml(quiz.pageTitle)} · 本页小测</h3>${qualityLine}${items.join("")}`);
  els.learningLoopOutput.querySelectorAll(".hint-button").forEach((button) => {
    button.addEventListener("click", () => {
      const hint = button.parentElement?.querySelector(".quiz-hint");
      if (hint) hint.hidden = !hint.hidden;
    });
  });
  els.learningLoopOutput.querySelectorAll(".grade-quiz-button").forEach((button) => {
    button.addEventListener("click", () => gradeQuizAnswer(button.dataset.questionId));
  });
}

function renderQuizDeveloperDetails(question) {
  return `
    <details class="loop-debug-details">
      <summary>developer details</summary>
      <p><strong>learningObjective：</strong>${escapeHtml(question.learningObjective ?? "")}</p>
      <p><strong>expectedAnswer：</strong>${escapeHtml(question.expectedAnswer ?? "")}</p>
      <p><strong>sourceEvidence：</strong>${escapeHtml(question.sourceEvidence ?? "")}</p>
      <p><strong>rubric full：</strong>${escapeHtml((question.scoringRubric?.fullCredit ?? []).join("；"))}</p>
      <p><strong>rubric partial：</strong>${escapeHtml((question.scoringRubric?.partialCredit ?? []).join("；"))}</p>
      <p><strong>commonMistakes：</strong>${escapeHtml((question.scoringRubric?.commonMistakes ?? []).join("；"))}</p>
    </details>
  `;
}

async function gradeQuizAnswer(questionId) {
  const card = els.learningLoopOutput.querySelector(`[data-question-id="${CSS.escape(questionId)}"]`);
  const answer = card?.querySelector(".quiz-answer")?.value ?? "";
  const resultBox = card?.querySelector(".grade-result");
  if (!answer.trim()) {
    if (resultBox) resultBox.textContent = "请先写下你的答案。";
    return;
  }
  try {
    const payload = await api("/api/learning-loop/grade", {
      materialId: state.material.id,
      pageIndex: state.pageIndex,
      learnerId: "demo-learner",
      quizId: state.activeQuiz.id,
      questionId,
      studentAnswer: answer,
      learnerLevel: els.learnerLevel.value
    });
    if (resultBox) {
      resultBox.innerHTML = `
        <p><strong>得分：</strong>${payload.gradingResult.score}/2 · ${escapeHtml(payload.gradingResult.mastery)}</p>
        <p>${escapeHtml(payload.gradingResult.feedback)}</p>
        <p><strong>下一步：</strong>${escapeHtml(payload.gradingResult.nextAction)}</p>
      `;
    }
    updateLoopProgress("review_scheduled");
  } catch (error) {
    if (resultBox) resultBox.textContent = `批改失败：${messageOf(error)}`;
  }
}

async function loadSessionReport() {
  if (!state.material) return showNotice("请先加载学习材料。", true);
  openLearningToolsDrawer("quiz", { keepContent: true });
  setLoopBusy("正在生成学习报告…");
  try {
    const payload = await api("/api/learning-loop/session-report", {
      materialId: state.material.id,
      pageIndex: state.pageIndex,
      learnerId: "demo-learner",
      learnerLevel: els.learnerLevel.value,
      questionsAsked: state.messages.filter((message) => message.role === "user").map((message) => message.content),
      ...resourceSearchPayload()
    });
    const report = payload.report;
    showLoopPanel(`
      <h3>本页学习报告</h3>
      <article class="loop-card">
        <strong>今天学习了</strong>
        ${renderLoopList((report.pagesStudied ?? []).map((page) => `第 ${page.pageIndex} 页：${page.title}`))}
      </article>
      <article class="loop-card">
        <strong>掌握较好</strong>
        ${renderLoopList(report.conceptsLearned ?? [])}
      </article>
      <article class="loop-card">
        <strong>还需要复习</strong>
        ${renderLoopList(report.weakConcepts ?? [])}
      </article>
      <article class="loop-card">
        <strong>总结</strong>
        <p>${escapeHtml(report.summary)}</p>
      </article>
      <details><summary>导出 Markdown</summary><pre class="material-text compact">${escapeHtml(payload.markdown ?? "")}</pre></details>
      <details><summary>导出 JSON</summary><pre class="material-text compact">${escapeHtml(JSON.stringify(report, null, 2))}</pre></details>
    `);
  } catch (error) {
    renderLoopError(error);
  }
}

function updateLoopProgress(stage) {
  const labels = {
    page_loaded: ["当前页理解", "向助教提问或生成本页小测"],
    answered_question: ["已完成问答", "生成小测检查理解"],
    quiz_generated: ["检查理解", "提交你的答案"],
    quiz_submitted: ["错因反馈", "查看学习记忆和复习任务"],
    memory_updated: ["学习记忆已更新", "查看复习任务或推荐资源"],
    review_scheduled: ["复习已安排", "按计划复习薄弱概念"]
  };
  const [label, next] = labels[stage] ?? labels.page_loaded;
  els.loopStageLabel.textContent = label;
  els.loopNextAction.textContent = next;
}

function setLoopBusy(text) {
  showLoopPanel(`<p class="empty">${escapeHtml(text)}</p>`);
}

function showLoopPanel(html) {
  els.learningLoopOutput.innerHTML = html;
  bindDrawerQuizButtons();
  bindTeacherConfigButtons();
}

function renderLoopError(error) {
  showLoopPanel(`<p class="empty error-text">学习闭环操作失败：${escapeHtml(messageOf(error))}</p>`);
}

function renderLoopList(items) {
  if (!items.length) return '<p class="empty">暂无</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function bindTeacherConfigButtons() {
  els.learningLoopOutput.querySelectorAll(".reload-teacher-dashboard").forEach((button) => {
    button.addEventListener("click", () => loadTeacherInsight());
  });
}

function teacherConfigPayload() {
  const read = (selector, fallback) => els.learningLoopOutput.querySelector(selector)?.value?.trim?.() || fallback;
  const studentCount = Number(read(".teacher-config-student-count", "5"));
  return {
    className: read(".teacher-config-class-name", "未来学校 Demo 班"),
    courseName: read(".teacher-config-course-name", "人工智能基础"),
    lessonName: read(".teacher-config-lesson-name", currentPageTitle()),
    teacherName: read(".teacher-config-teacher-name", ""),
    studentCount: Number.isFinite(studentCount) && studentCount > 0 ? studentCount : 5,
    dataSource: read(".teacher-config-data-source", "demo_mock_class")
  };
}

function renderTeacherConfigForm(dashboard) {
  const config = dashboard?.config ?? teacherConfigPayload();
  return `
    <article class="loop-card teacher-config-card" data-testid="teacher-config-card">
      <strong>班级设置</strong>
      <div class="teacher-config-grid">
        <label>班级名称<input class="teacher-config-class-name" value="${escapeAttribute(config.className ?? "未来学校 Demo 班")}" /></label>
        <label>课程名称<input class="teacher-config-course-name" value="${escapeAttribute(config.courseName ?? "人工智能基础")}" /></label>
        <label>本节课名称<input class="teacher-config-lesson-name" value="${escapeAttribute(config.lessonName ?? currentPageTitle())}" /></label>
        <label>教师名称<input class="teacher-config-teacher-name" value="${escapeAttribute(config.teacherName ?? "")}" placeholder="可选" /></label>
        <label>学生人数<input class="teacher-config-student-count" type="number" min="1" value="${escapeAttribute(config.studentCount ?? 5)}" /></label>
        <label>数据来源
          <select class="teacher-config-data-source">
            <option value="demo_mock_class" ${config.dataSource === "demo_mock_class" ? "selected" : ""}>Demo 班级数据，仅用于演示</option>
            <option value="real_learner_memory" ${config.dataSource === "real_learner_memory" ? "selected" : ""}>真实学习记录</option>
            <option value="mixed" ${config.dataSource === "mixed" ? "selected" : ""}>真实学习记录 + Demo 数据</option>
          </select>
        </label>
      </div>
      <button type="button" class="reload-teacher-dashboard">刷新教师看板</button>
    </article>
  `;
}

function resourceStatusText(payload) {
  if (payload.status === "web_search") return "使用联网搜索";
  if (payload.status === "teacher_library") return "使用教师资源库";
  if (payload.status === "not_configured") return "未配置搜索服务";
  if (payload.status === "failed") return "搜索失败";
  return payload.message ?? "当前没有找到可靠资源";
}

function readableTeacherDataSource(source) {
  if (source === "real_learner_memory") return "真实学习记录";
  if (source === "mixed") return "真实学习记录 / Demo 班级数据";
  return "Demo 班级数据";
}

function renderConceptMap(conceptMap) {
  if (!conceptMap?.nodes?.length) return '<p class="empty">暂无概念地图。完成小测后，这里会逐步显示掌握状态。</p>';
  const nodes = conceptMap.nodes
    .map((node) => `<span class="concept-node ${escapeHtml(node.status)}">${escapeHtml(node.label)}</span>`)
    .join("");
  const edges = (conceptMap.edges ?? [])
    .map((edge) => {
      const from = conceptMap.nodes.find((node) => node.id === edge.from)?.label ?? edge.from;
      const to = conceptMap.nodes.find((node) => node.id === edge.to)?.label ?? edge.to;
      return `${from} → ${to}`;
    })
    .slice(0, 8);
  return `
    <h4>概念地图</h4>
    <div class="concept-map">${nodes}</div>
    ${renderLoopList(edges)}
  `;
}

function applyMaterialPayload(payload, options = {}) {
  const previousPageIndex = state.pageIndex;
  state.material = payload.material;
  state.page = payload.page;
  state.context = payload.context;
  state.pageIndex = payload.page?.pageIndex ?? 1;
  if (options.resetMessages) {
    state.messages = [];
    state.latestResponse = null;
    clearDebug();
  }

  const fileName = state.material.fileName ?? state.material.title ?? state.material.id;
  els.topMaterialLine.textContent = `当前材料：${fileName} · ${state.material.pageCount} 页 · 第 ${state.pageIndex} / ${state.material.pageCount} 页`;
  els.pageCounter.textContent = `${state.pageIndex} / ${state.material.pageCount}`;
  els.pageIndexInput.value = String(state.pageIndex);
  els.pageIndexInput.max = String(state.material.pageCount);
  els.pageTitle.textContent = currentPageTitle();
  els.pageText.textContent = state.page?.text ?? "";
  els.pageMarkdown.textContent = payload.pageMarkdown ?? "";
  els.pageMarkdownDrawer.textContent = payload.pageMarkdown ?? "";
  renderSlidePreview(state.page);
  els.prevPage.disabled = state.pageIndex <= 1;
  els.nextPage.disabled = state.pageIndex >= state.material.pageCount;
  if (!els.learningToolsDrawer.hidden && previousPageIndex !== state.pageIndex) {
    state.activeQuiz = null;
    if (state.learningLoopTab === "quiz") {
      renderQuizIntro("当前页已切换。为了避免使用旧页面的小测，请重新生成本页小测。");
    }
  }
  updateLoopProgress("page_loaded");
  renderChat();
  updateRuntimeStatus(state.latestResponse);
}

function renderSlidePreview(page, message) {
  const preview = page?.preview;
  const imageUrl = page?.previewImageUrl ?? preview?.imageUrl;
  els.slidePreview.hidden = true;
  els.slidePreview.removeAttribute("src");
  els.slidePreviewStatus.classList.remove("failed");

  if (message) {
    els.slidePreviewStatus.textContent = message;
    if (/失败|failed|error/i.test(message)) els.slidePreviewStatus.classList.add("failed");
    return;
  }

  if (!page) {
    els.slidePreviewStatus.textContent = "当前页预览生成中……";
    return;
  }

  if (preview?.status === "ready" && imageUrl) {
    els.slidePreview.src = imageUrl;
    els.slidePreview.hidden = false;
    els.slidePreviewStatus.textContent = "";
    return;
  }

  if (preview?.status === "rendering") {
    els.slidePreviewStatus.textContent = "当前页预览生成中……";
    return;
  }

  els.slidePreviewStatus.classList.add("failed");
  els.slidePreviewStatus.textContent = `当前页预览渲染失败，已显示解析文本。\n${preview?.error ?? "当前渲染器不可用"}`;
}

function renderChat() {
  els.chatWindow.innerHTML = "";
  // renderMarkdown(response.answer) compatibility marker: assistant answers are stored in message.content before rendering.
  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "assistant-empty-state";
    empty.innerHTML = `
      <strong>可以直接问当前页。</strong>
      <span>例如“这页主要讲什么？”、“这里最容易混淆的点是什么？”</span>
      <span>${runtimeHint()}</span>
    `;
    els.chatWindow.append(empty);
    return;
  }

  for (const message of state.messages) {
    const item = document.createElement("article");
    item.className = `message ${message.role}${message.error ? " error" : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (message.role === "assistant") {
      const answer = document.createElement("div");
      answer.className = "answer-markdown";
      answer.innerHTML = renderMarkdown(message.content);
      bubble.append(answer);
      if (message.response?.citations?.length) bubble.append(compactCitationBar(message.response.citations));
    } else {
      bubble.textContent = message.content;
    }
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const stale = message.pageIndex !== state.pageIndex ? ` · 此回答基于第 ${message.pageIndex} 页生成` : "";
    meta.textContent = `${message.role === "user" ? "学生" : "助教"} · 第 ${message.pageIndex} 页《${message.pageTitle ?? "当前页"}》${stale}`;
    item.append(bubble, meta);
    els.chatWindow.append(item);
  }
  els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
}

function compactCitationBar(citations) {
  const bar = document.createElement("div");
  bar.className = "compact-citations";
  const sources = [...new Map(citations.map((citation) => [formatCitationTitle(citation), citation])).values()].slice(0, 4);
  for (const citation of sources) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `引用：${shortCitation(citation)}`;
    button.addEventListener("click", () => {
      els.evidenceDetails.open = true;
      if (citation.sourceType === "current_page" && citation.pageIndex) goToPage(citation.pageIndex);
      els.evidenceDetails.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    bar.append(button);
  }
  return bar;
}

function renderDebug(response) {
  renderCitationSummary(response.citations ?? []);
  renderTraceItems(els.generationBox, {
    mode: response.generationDebug?.answerGenerationMode ?? "n/a",
    provider: response.generationDebug?.providerName ?? "none",
    model: response.generationDebug?.modelName ?? "none",
    llmConfigured: yesNo(response.generationDebug?.llmConfigured),
    rawLlmCalled: yesNo(response.generationDebug?.rawLlmCalled),
    templateFallback: yesNo(response.generationDebug?.usedTemplateFallback),
    groundingPassed: yesNo(response.generationDebug?.groundingPassed),
    llmFailure: response.generationDebug?.llmFailureReason ?? "none",
    groundingFailure: response.generationDebug?.groundingFailureReason ?? "none"
  });
  renderAnswerability(response.decisionTrace?.answerability);
  renderTrace(response.decisionTrace);
  renderKeyGrid(els.policyBox, {
    style: response.teachingPolicy?.style ?? "n/a",
    depth: response.teachingPolicy?.depth ?? "n/a",
    source: response.teachingPolicy?.source ?? "n/a",
    retrieve: yesNo(response.teachingPolicy?.shouldRetrieveKnowledge),
    language: response.teachingPolicy?.answerLanguage ?? "n/a"
  });
  renderKeyGrid(els.usedContext, {
    当前页: yesNo(response.usedContext?.usedCurrentPage),
    大纲: yesNo(response.usedContext?.usedOutline),
    讲稿: yesNo(response.usedContext?.usedTeacherScript),
    前后页: yesNo(response.usedContext?.usedNeighborPages),
    学生画像: yesNo(response.usedContext?.usedLearnerProfile),
    历史对话: yesNo(response.usedContext?.usedChatHistory)
  });
  renderSkills(response.usedSkills ?? [], response.retrievalDebug);
  renderEvidence(els.selectedEvidenceList, response.evidenceDebug?.selected ?? [], "selected");
  renderRejectedEvidence(response.evidenceDebug?.rejected ?? []);
  renderCitations(response.citations ?? []);
  els.rawResponseBox.textContent = JSON.stringify(redactResponse(response), null, 2);
}

function renderCitationSummary(citations) {
  els.citationSummary.innerHTML = "";
  if (!citations.length) {
    els.citationSummary.innerHTML = '<p class="empty">当前回答没有支持性引用。</p>';
    return;
  }
  citations.forEach((citation, index) => {
    const item = document.createElement("div");
    item.className = "reference-chip";
    item.textContent = `${index + 1}. ${formatCitationTitle(citation)}`;
    els.citationSummary.append(item);
  });
}

function renderAnswerability(answerability) {
  if (!answerability) {
    els.answerabilityBox.innerHTML = '<p class="empty">无 answerability 信息</p>';
    return;
  }
  renderTraceItems(els.answerabilityBox, {
    status: answerability.status,
    requiredEvidence: answerability.requiredEvidenceType,
    refuseToInvent: yesNo(answerability.shouldRefuseToInvent),
    missing: (answerability.missingEvidence ?? []).join("; ") || "none",
    reason: answerability.reason
  });
}

function renderTrace(trace) {
  if (!trace) {
    els.traceBox.innerHTML = '<p class="empty">无决策摘要</p>';
    return;
  }
  renderTraceItems(els.traceBox, {
    intent: trace.detectedIntent,
    entities: (trace.keyEntities ?? []).join(", ") || "none",
    currentPageScore: trace.contextRelevance?.currentPage?.score ?? "n/a",
    kbScore: trace.contextRelevance?.knowledgeBase?.score ?? "n/a",
    evidence: `${trace.evidenceSelection?.selectedCount ?? 0} selected / ${trace.evidenceSelection?.rejectedCount ?? 0} rejected`,
    retrieval: `${trace.retrievalDecision?.needed ? "needed" : "not needed"} / ${trace.retrievalDecision?.called ? "called" : "not called"} / ${
      trace.retrievalDecision?.resultStatus ?? "n/a"
    }`,
    grounding: `${trace.groundingCheck?.passed ? "passed" : "failed"}: ${trace.groundingCheck?.reason ?? ""}`,
    uncertainty: trace.uncertainty ?? "none"
  });
}

function renderSkills(skills, retrieval) {
  if (skills.length === 0 && !retrieval) {
    els.skillList.innerHTML = '<p class="empty">无 skill 调用</p>';
    return;
  }
  const values = Object.fromEntries(skills.map((skill) => [skill.name, `${skill.status}: ${skill.reason}`]));
  if (retrieval) {
    values.retrieval = `${retrieval.status}; top=${retrieval.topScore ?? "n/a"}; threshold=${retrieval.relevanceThreshold}; sufficient=${yesNo(
      retrieval.evidenceSufficient
    )}`;
    const hardRejected = (retrieval.rejectedChunks ?? []).some((item) => String(item.reason ?? "").includes("hard relevance rule"));
    if (retrieval.status === "empty" && hardRejected && Number(retrieval.topScore ?? 0) >= Number(retrieval.relevanceThreshold ?? 0)) {
      values.retrievalNote = "检索命中了一些片段，但它们没有覆盖问题中的核心实体 / 概念，因此未作为证据使用。";
    }
  }
  renderTraceItems(els.skillList, values);
}

function renderKeyGrid(container, values) {
  container.innerHTML = "";
  for (const [key, value] of Object.entries(values)) {
    const item = document.createElement("div");
    item.className = "key-item";
    const label = document.createElement("strong");
    label.textContent = key;
    const val = document.createElement("span");
    val.textContent = value;
    item.append(label, val);
    container.append(item);
  }
}

function renderTraceItems(container, values) {
  container.innerHTML = "";
  for (const [key, value] of Object.entries(values)) {
    const item = document.createElement("div");
    item.className = "trace-item";
    const label = document.createElement("strong");
    label.textContent = key;
    const val = document.createElement("span");
    val.textContent = String(value);
    item.append(label, val);
    container.append(item);
  }
}

function renderEvidence(container, evidence, label) {
  container.innerHTML = "";
  if (evidence.length === 0) {
    container.innerHTML = `<p class="empty">无 ${label} evidence</p>`;
    return;
  }
  evidence.forEach((item) => {
    container.append(evidenceCard(item, `${item.sourceType}: ${item.title ?? item.sourceId ?? "untitled"}`, item.text));
  });
}

function renderRejectedEvidence(rejected) {
  els.rejectedEvidenceList.innerHTML = "";
  if (rejected.length === 0) {
    els.rejectedEvidenceList.innerHTML = '<p class="empty">无 rejected evidence</p>';
    return;
  }
  rejected.slice(0, 8).forEach((item) => {
    els.rejectedEvidenceList.append(
      evidenceCard(item.evidence, `${item.evidence.sourceType}: ${item.evidence.title ?? "untitled"}`, `${item.reason}\n\n${item.evidence.text ?? ""}`)
    );
  });
}

function renderCitations(citations) {
  els.citationList.innerHTML = "";
  if (citations.length === 0) {
    els.citationList.innerHTML = '<p class="empty">无引用来源</p>';
    return;
  }
  citations.forEach((citation) => {
    const item = document.createElement("article");
    item.className = "citation";
    const title = document.createElement("strong");
    title.textContent = formatCitationTitle(citation);
    const chunk = document.createElement("code");
    chunk.textContent = citation.chunkId ?? citation.sourceId ?? "";
    const preview = document.createElement("p");
    preview.textContent = citation.textPreview ?? "";
    item.append(title, chunk, preview);
    if (citation.sourceType === "current_page" && citation.pageIndex) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "定位到课件页";
      button.addEventListener("click", () => goToPage(citation.pageIndex));
      item.append(button);
    }
    els.citationList.append(item);
  });
}

function evidenceCard(item, titleText, bodyText) {
  const card = document.createElement("article");
  card.className = "citation";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const meta = document.createElement("code");
  meta.textContent = [item.chunkId, item.sourceId, item.relevanceScore ? `score=${Number(item.relevanceScore).toFixed(2)}` : ""]
    .filter(Boolean)
    .join(" | ");
  const preview = document.createElement("p");
  preview.textContent = summarize(bodyText, 260);
  card.append(title, meta, preview);
  return card;
}

function clearDebug() {
  els.citationSummary.innerHTML = "";
  els.generationBox.innerHTML = "";
  els.answerabilityBox.innerHTML = "";
  els.traceBox.innerHTML = "";
  els.policyBox.innerHTML = "";
  els.usedContext.innerHTML = "";
  els.skillList.innerHTML = "";
  els.selectedEvidenceList.innerHTML = "";
  els.rejectedEvidenceList.innerHTML = "";
  els.citationList.innerHTML = "";
  els.rawResponseBox.textContent = "";
  els.modeStatus.textContent = "回答模式：等待提问";
  els.skillStatus.textContent = "知识库：待使用";
  els.confidenceStatus.textContent = "置信度：暂无";
}

function updateRuntimeStatus(response) {
  const provider = els.llmProvider.value === "kimi" ? "KIMI" : "OpenAI-compatible";
  const model = els.llmModel.value.trim() || (els.llmProvider.value === "kimi" ? "kimi-k2.5" : "default");
  const hasRequestKey = Boolean(els.llmApiKey.value.trim());
  const hasEnvLlm = Boolean(state.config?.llm?.enabled);
  if (hasRequestKey || hasEnvLlm) {
    els.llmStatus.textContent = `模型：${provider} / ${model}${hasRequestKey ? "（本次会话）" : "（环境变量）"}`;
  } else {
    els.llmStatus.textContent = "模型未连接：请在“模型设置”中填写 API Key";
  }
  els.llmHint.textContent = hasRequestKey || hasEnvLlm
    ? "模型已可用，提问会结合当前页和可用证据回答。"
    : "当前未配置真实模型。可以先配置 API Key，或只查看课件。";

  if (response) {
    els.modeStatus.textContent = readableMode(response);
    els.skillStatus.textContent = readableSkill(response);
    els.confidenceStatus.textContent = `置信度：${readableConfidence(response.confidence)}`;
  }
  els.askButton.disabled = isRealLlmRequiredButMissing() || !state.material;
  els.openQuizShortcut.disabled = !hasUsableLlm() || !state.material;
}

function readableMode(response) {
  if (response.answerability === "not_answerable" || response.decisionTrace?.answerability?.status === "not_answerable") return "回答来源：资料不足，已拒绝编造";
  if (response.retrievalDebug?.status === "success") return "回答来源：知识库证据";
  if (response.usedContext?.usedCurrentPage) return "回答来源：当前页";
  return response.answerGenerationMode ? `生成模式：${readableGenerationMode(response.answerGenerationMode)}` : "回答来源：已生成";
}

function readableSkill(response) {
  const skill = response.usedSkills?.find((item) => item.name === "KnowledgeRetrievalSkill");
  if (!skill || skill.status === "skipped") return "知识库：本题未调用";
  if (response.retrievalDebug?.status === "success") return "知识库：已找到证据";
  if (response.retrievalDebug?.status === "empty") return "知识库：未找到可靠证据";
  return `知识库：${skill.status}`;
}

function readableConfidence(confidence) {
  if (confidence === "high") return "高";
  if (confidence === "medium") return "中";
  if (confidence === "low") return "低";
  return "暂无";
}

function readableGenerationMode(mode) {
  const labels = {
    real_llm: "真实模型",
    mock_llm: "模拟模型",
    template_fallback: "模板兜底",
    guardrail_template: "安全拒答模板",
    unavailable: "不可用"
  };
  return labels[mode] ?? mode;
}

function isRealLlmRequiredButMissing() {
  return els.requireRealLlm.checked && !els.llmApiKey.value.trim() && !state.config?.llm?.enabled;
}

function hasUsableLlm() {
  return Boolean(els.llmApiKey.value.trim() || state.config?.llm?.enabled);
}

function resourceSearchPayload() {
  return {
    resourceSearchProvider: els.resourceSearchProvider.value,
    tavilyApiKey: els.tavilyApiKey.value.trim(),
    bingSearchApiKey: els.bingSearchApiKey.value.trim(),
    serpApiKey: els.serpApiKey.value.trim()
  };
}

function setBusy(isBusy, label = "提问") {
  els.askButton.disabled = isBusy || isRealLlmRequiredButMissing() || !state.material;
  els.openQuizShortcut.disabled = isBusy || !hasUsableLlm() || !state.material;
  els.loadButton.disabled = isBusy;
  els.prevPage.disabled = isBusy || !state.material || state.pageIndex <= 1;
  els.nextPage.disabled = isBusy || !state.material || state.pageIndex >= (state.material?.pageCount ?? 1);
  els.askButton.textContent = isBusy ? label : "提问";
}

function showNotice(text, isError = false, fresh = false) {
  els.pageNotice.textContent = text;
  els.pageNotice.classList.toggle("is-fresh", fresh && !isError);
  els.pageNotice.style.color = isError ? "var(--red)" : "";
}

function openSlideModal() {
  const src = els.slidePreview.getAttribute("src");
  if (!src) return;
  els.slideModalImage.src = src;
  if (typeof els.slideModal.showModal === "function") els.slideModal.showModal();
  else window.open(src, "_blank", "noopener,noreferrer");
}

async function api(url, body) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      : undefined
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "request failed");
  return payload;
}

function currentPageTitle() {
  return state.page?.semanticTitle ?? state.page?.title ?? `第 ${state.pageIndex} 页`;
}

function runtimeHint() {
  return els.llmHint?.textContent || "可以先查看课件，配置模型后再提问。";
}

function shortCitation(citation) {
  if (citation.sourceType === "current_page") return `当前页《${citation.semanticTitle ?? citation.title ?? "课件页"}》`;
  if (citation.sourceType === "wiki" || citation.sourceType === "knowledge_base") return `知识库：${citation.sectionTitle ?? citation.title ?? "片段"}`;
  if (citation.sourceType === "outline" || citation.sourceType === "neighbor_page") return "课件上下文";
  return citation.sourceType;
}

function formatCitationTitle(citation) {
  if (citation.sourceType === "current_page" && citation.pageIndex) {
    const title = citation.semanticTitle ?? citation.title ?? citation.sourceId ?? "untitled";
    const file = citation.fileName ? `${citation.fileName} / ` : "";
    return `current_page: ${file}Slide ${citation.pageIndex}《${title}》`;
  }
  if (citation.sourceType === "outline" || citation.sourceType === "neighbor_page") {
    return `deck_context: ${citation.title ?? citation.sourceId ?? "untitled"}`;
  }
  return `${citation.sourceType}: ${citation.title ?? citation.sourceId ?? "untitled"}`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = null;
  let tableRows = [];

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    closeList();
    html.push("<table>");
    tableRows.forEach((cells, index) => {
      const tag = index === 0 ? "th" : "td";
      html.push(`<tr>${cells.map((cell) => `<${tag}>${inlineMarkdown(cell)}</${tag}>`).join("")}</tr>`);
    });
    html.push("</table>");
    tableRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushTable();
      closeList();
      continue;
    }
    if (/^---+$/.test(line)) {
      flushTable();
      closeList();
      html.push("<hr />");
      continue;
    }
    if (/^\|.+\|$/.test(line)) {
      const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) tableRows.push(cells);
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  flushTable();
  closeList();
  return html.join("\n");
}

function inlineMarkdown(text) {
  return escapeHtml(String(text ?? ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function summarize(text, maxLength) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function redactResponse(response) {
  return JSON.parse(
    JSON.stringify(response, (key, value) => {
      if (/api.?key/i.test(key)) return "[redacted]";
      if (typeof value === "string") return value.replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED_API_KEY]");
      return value;
    })
  );
}
