# AGENTS.md — Lightweight Education LLM Wiki Operating Manual

This file is the system-level harness for a lightweight Education LLM Wiki. It governs how agents organize, update, query, and maintain the vault.

Design principle: **learner-first, evidence-backed, harness-controlled, token-efficient**.

The agent should keep this file as the always-on operating manual. Detailed step execution lives in `99_System/Skills/` and page formats live in `99_System/Templates/`.

---

## 1. Purpose

This vault is a persistent, interlinked, compounding markdown knowledge base for educational use.

It is not a generic document archive. It is not a pile of AI papers, product notes, course materials, or random summaries.

Its purpose is to turn raw sources, concepts, learning maps, source notes, insights, and valuable learner questions into a reusable knowledge environment.

The goal is to make knowledge accumulate over time instead of disappearing into chat history.

The vault should feel like:

1. a learning environment first;
2. an evidence-backed wiki second;
3. a maintainable system always.

Default language: **Chinese**. Keep necessary English technical terms, canonical titles, and source titles. Do not mechanically provide bilingual duplication unless requested.

---

## 2. Karpathy-style LLM Wiki Principle

This vault follows the LLM Wiki pattern:

```text
raw source material
      ↓
LLM reads, extracts, links, updates, and maintains
      ↓
structured markdown wiki
      ↓
queries and new sources continue to compound the wiki
```

The agent should not answer every question by re-reading raw sources from scratch when a compiled wiki layer already exists.

The wiki layer is a **middle knowledge layer**: structured, source-traceable, linked, refreshable, and easier for future agents to use.

Core principles:

1. Raw sources are the immutable source of truth.
2. The wiki is the compiled and maintained knowledge layer.
3. Schema files, skills, templates, index, and log are the system harness.
4. New sources should update the wiki, not merely produce one-off summaries.
5. Valuable learner queries should feed back into the wiki.
6. Maintenance is required to prevent drift, duplication, contradiction, and stale claims.

---

## 3. Three-layer Architecture

| Layer | Meaning in this vault | Rule |
|---|---|---|
| Raw Sources | immutable original materials | the agent may read them but must not rewrite them |
| Wiki | learning maps, concept pages, source notes, insights, query feedback | the agent may create and update them |
| Schema / Harness | AGENTS.md, skills, templates, index, log, lint reports | the agent must follow them |

Important rule:

> The LLM owns the wiki layer, not the raw-source layer.

---

## 4. Directory Contract

Do not create an over-complex directory tree.

Use this minimum viable structure:

```text
Education_LLM_Wiki/
├── AGENTS.md
├── index.md
├── log.md
├── 00_Start_Here/
├── 01_Learning_Maps/
├── 02_Core_Concepts/
├── 03_Source_Notes/
├── 04_Insights/
├── 05_Query_Feedback/
├── 90_Raw_Sources/
└── 99_System/
    ├── Skills/
    └── Templates/
```

Root should keep only:

- `AGENTS.md`
- `index.md`
- `log.md`

Do not create separate top-level folders for:

- Misconceptions
- Practice_and_Assessments
- Transfer_Use_Cases
- Teaching_Strategies
- Source_Claims
- Derived_Insights
- Metadata
- Prompts_and_Logs

These are intentionally folded into the lightweight structure.

---

## 5. Folder Roles

| Folder | Role |
|---|---|
| `00_Start_Here/` | learner orientation and vault entry point |
| `01_Learning_Maps/` | topic maps, learning paths, concept routes |
| `02_Core_Concepts/` | stable concept pages and core explanations |
| `03_Source_Notes/` | processed notes from raw sources, including key claims and evidence |
| `04_Insights/` | cross-source synthesis, patterns, gaps, principles, transferable methods |
| `05_Query_Feedback/` | query inbox, learner questions, write-back decisions, reflection logs |
| `90_Raw_Sources/` | immutable raw materials |
| `99_System/Skills/` | step-level execution protocols |
| `99_System/Templates/` | reusable page templates |

---

## 6. Page Types

Use only these page types unless there is a strong reason to extend the schema.

| Type | Preferred location | Description |
|---|---|---|
| `start_here` | `00_Start_Here/` | vault orientation note |
| `learning_map` | `01_Learning_Maps/` | topic map or learning path |
| `concept` | `02_Core_Concepts/` | core concept page |
| `source_note` | `03_Source_Notes/` | processed note for one source or source cluster |
| `insight` | `04_Insights/` | cross-source synthesis, principle, pattern, gap, or method |
| `query_feedback` | `05_Query_Feedback/` | query record, learning-state reflection, write-back decision |
| `lint_report` | `99_System/` | wiki health-check report |
| `template` | `99_System/Templates/` | reusable page template |
| `skill` | `99_System/Skills/` | reusable execution protocol |
| `system` | `99_System/` | maintenance, prompt, checklist, or system file |

---

## 7. Global Metadata Contract

All non-raw pages require YAML frontmatter.

Every knowledge object must know:

1. where its knowledge comes from;
2. how likely that knowledge is to become outdated;
3. how it connects to other wiki objects.

Use this default frontmatter:

```yaml
---
type:
id:
title:

# Source traceability
source_ids: []
source_types: []
source_owners: []

# Knowledge links
related_concepts: []
related_insights: []

# Status and quality
status: draft
needs_review: true
confidence:
freshness: unknown
last_checked:
next_review:
review_reason:

created:
updated:
---
```

### 7.1 Source Traceability

Source traceability answers:

> Where does this knowledge come from?

Rules:

1. All generated or updated notes must preserve `source_ids` where source support is relevant.
2. Source notes should record `source_types` and `source_owners` when known.
3. Concept pages, learning maps, and insights should inherit or reference the relevant source notes through `source_ids`.
4. If source support is missing or unclear, mark `confidence: low` and `needs_review: true`.
5. Do not publish an insight without traceable source support.

### 7.2 Freshness Control

Freshness control answers:

> How likely is this knowledge to become outdated?

Use these levels:

| Freshness | Meaning | Typical examples |
|---|---|---|
| `stable` | unlikely to change frequently | foundational theories, classic concepts, historical sources |
| `time_sensitive` | may change and should be periodically reviewed | policies, course schedules, tool comparisons, market reports |
| `volatile` | likely to change quickly | AI product features, model rankings, prices, live datasets, current statistics |
| `unknown` | freshness has not been assessed | newly ingested or unclear sources |

Rules:

1. Teacher course materials may be stable within a course context, but their source information must still be preserved.
2. External sources should not default to `stable`.
3. Pages using volatile or time-sensitive external data should include `last_checked` and `next_review`.
4. If `next_review` has passed, mark `needs_review: true` and explain the reason in `review_reason`.
5. If freshness is unclear, use `freshness: unknown` and mark the page for review.

Freshness is a **cross-cutting rule**, not a separate workflow step. Check it during:

- Source Loop triage;
- Query Loop retrieval/reflection;
- Maintenance Loop audit/repair.

---

## 8. Lightweight Boundary Rules

This vault avoids over-fragmentation.

Use these boundaries:

| Object | Boundary |
|---|---|
| Learning Map | 学习者应该怎么进入一个主题 |
| Core Concept | 一个概念是什么、为什么重要、怎么理解 |
| Source Note | 某个 source 讲了什么、有哪些 key claims 和 evidence |
| Insight | 跨 source / 跨概念沉淀出的模式、原则、gap 或方法论 |
| Query Feedback | 用户问题暴露了什么理解缺口，是否需要写回 wiki |
| System | 模板、skills、lint、维护规则、prompt、checklist |
| Raw Source | 原始材料，不修改 |

Do not create separate folders for minor page functions. Instead:

| Content type | Where it goes |
|---|---|
| Misconception / common confusion | inside concept pages under `Common Confusions` |
| Practice / assessment | inside learning maps under `Check Yourself` |
| Transfer use case | inside insights under `Applications / Transfer` |
| Teaching notes | inside concepts or learning maps under `Teaching Notes` |
| Source claim | inside source notes under `Key Claims` |
| Derived insight | inside `04_Insights/` as `type: insight` |
| Metadata | in frontmatter |
| Prompts and maintenance logs | in `99_System/` or root `log.md` |

---

## 9. Operating Loops and Skill Routing

This wiki is maintained through three operating loops.

The agent must classify the user's request into one of these loops before acting.

Detailed execution lives in `99_System/Skills/`. AGENTS.md defines only the system-level routing and non-negotiable contracts.

---

### 9.1 Source Loop — New Material Enters the Wiki

Use when new raw material enters the vault.

Typical triggers:

- The user provides an article, PDF, transcript, lecture note, webpage, dataset, screenshot text, or pasted source.
- The user says: “add this to the wiki”, “process this source”, “整理这篇文章”, “把这个资料写进知识库”.
- A new file appears in `90_Raw_Sources/`.

Flow:

```text
Intake → Triage → Parse → Compile → Integrate → Record
```

Purpose:

> Turn raw sources into reusable, source-traceable wiki knowledge.

Stage meanings:

| Stage | Meaning | Main skill |
|---|---|---|
| Intake | receive and preserve raw material | `ingest_and_parse_source.md` |
| Triage | classify source type, owner, relevance, freshness, processing path | `ingest_and_parse_source.md` |
| Parse | extract key concepts, key claims, evidence, limitations | `ingest_and_parse_source.md` |
| Compile | create or update concepts, learning maps, insights | `compile_wiki_pages.md` |
| Integrate | merge into existing wiki, add links, avoid duplicates | `integrate_and_record.md` |
| Record | update index/log when needed | `integrate_and_record.md` |

Outputs:

- Raw source preserved in `90_Raw_Sources/` or referenced if already external.
- Source note created or updated in `03_Source_Notes/`.
- Concept, learning map, or insight updated when needed.
- `index.md` updated if navigation changes.
- `log.md` appended.

Non-negotiable rule:

> Do not directly turn a raw source into a learner-facing concept, learning map, or insight without a source-note step, unless the user explicitly asks for a one-off answer and no wiki update is being made.

---

### 9.2 Query Loop — User Questions Improve the Wiki

Use when the user asks a question.

Typical triggers:

- The user asks for an explanation, comparison, synthesis, review, decision support, or learning path.
- The user asks: “what do we know about X?”, “这个概念怎么理解”, “这个和那个有什么区别”.
- The user asks a question that might reveal a missing concept, weak explanation, or better learning route.

Flow:

```text
Query → Retrieve → Answer → Reflect → Write Back → Record
```

Purpose:

> Answer from the compiled wiki first, then decide whether the query should improve the wiki.

Stage meanings:

| Stage | Meaning | Main skill |
|---|---|---|
| Query | understand the user's question and intent | `answer_query_and_writeback.md` |
| Retrieve | read index and relevant wiki pages before raw sources when possible | `answer_query_and_writeback.md` |
| Answer | produce a useful learner-facing answer | `answer_query_and_writeback.md` |
| Reflect | decide what the question reveals about the wiki | `answer_query_and_writeback.md` |
| Write Back | log valuable query feedback or update wiki pages | `answer_query_and_writeback.md`, optionally `compile_wiki_pages.md` |
| Record | update log/index if needed | `integrate_and_record.md` |

Outputs:

- User-facing answer.
- Optional query feedback entry in `05_Query_Feedback/Query_Inbox.md`.
- Optional updated concept, learning map, source note, or insight.
- `log.md` appended for high-value queries.

Write-back decision questions:

1. Does the query reveal a missing concept?
2. Does it reveal a weak explanation?
3. Does it reveal a common confusion?
4. Does it suggest a better learning map?
5. Does it expose an evidence gap?
6. Does it produce a reusable insight?
7. Does it reveal stale or time-sensitive knowledge?

High-value queries should not remain only in chat.

---

### 9.3 Maintenance Loop — Keep the Wiki Healthy

Use when checking wiki health.

Typical triggers:

- Several sources have been ingested.
- Several high-value queries have been written back.
- The index feels outdated.
- A contradiction, stale claim, orphan page, duplicate page, or missing source is suspected.
- The user asks for a system review.
- A scheduled maintenance pass occurs.

Flow:

```text
Audit → Diagnose → Repair → Review → Record
```

Purpose:

> Prevent the wiki from decaying, duplicating, contradicting itself, or becoming outdated.

Stage meanings:

| Stage | Meaning | Main skill |
|---|---|---|
| Audit | scan wiki for structural, evidence, freshness, and navigation issues | `lint_and_repair_wiki.md` |
| Diagnose | classify issues by severity and type | `lint_and_repair_wiki.md` |
| Repair | merge, relink, mark, refresh, or suggest fixes | `lint_and_repair_wiki.md` |
| Review | mark uncertain/high-impact content for human review | `lint_and_repair_wiki.md` |
| Record | update lint report, index, log | `integrate_and_record.md` |

Outputs:

- `99_System/Lint_Report.md`.
- Pages marked `needs_review: true` where needed.
- Suggested merges, archives, relinks, or new pages.
- `index.md` updated if navigation changes.
- `log.md` appended.

---

## 10. Skill Inventory

Use only these lightweight skills unless the system later scales.

| Skill | Main purpose | Used by |
|---|---|---|
| `ingest_and_parse_source.md` | Intake, triage, and parse new material into source notes | Source Loop |
| `compile_wiki_pages.md` | Compile source notes or query feedback into concept pages, learning maps, and insights | Source Loop, Query Loop |
| `answer_query_and_writeback.md` | Answer user questions from the wiki and decide whether to write back | Query Loop |
| `lint_and_repair_wiki.md` | Audit, diagnose, repair, and review wiki health | Maintenance Loop |
| `integrate_and_record.md` | Merge updates, maintain links, update index and log | All loops |

Do not load all skills for every task. Load only:

1. this `AGENTS.md`;
2. the relevant skill or skills;
3. the relevant template;
4. the relevant wiki pages.

This is the token-efficiency harness.

---

## 11. Index Contract

`index.md` is the current navigation map.

It must be organized by learner journey, not by source list.

Recommended structure:

```md
# Index

## Start Here

## Learning Maps

## Core Concepts

## Source Notes

## Insights

## Query Feedback

## System
```

Each entry should use this format:

```md
- [[Page Title]] — one-line description. type: concept. status: draft.
```

Update `index.md` after:

- page creation;
- page rename;
- page archive;
- major page update;
- high-value query write-back;
- ingest that changes navigation;
- lint pass that finds navigation gaps.

---

## 12. Log Contract

`log.md` is append-only.

Do not rewrite historical entries unless the log itself is corrupted.

Every material ingest, high-value query write-back, major page update, structural change, lint pass, review event, merge, and archive must be logged.

Allowed operation labels:

- `initialize`
- `ingest`
- `query`
- `update`
- `lint`
- `review`
- `refactor`
- `archive`

Recommended format:

```md
## [YYYY-MM-DD] operation | Short Title

- Summary:
- Pages created:
- Pages updated:
- Pages archived:
- Review flags:
- Notes:
```

---

## 13. Non-negotiable Rules

1. Preserve raw sources. Do not rewrite files in `90_Raw_Sources/`.
2. Do not create learner-facing wiki pages directly from raw sources without a source-note step when performing wiki updates.
3. Preserve source traceability through `source_ids`.
4. Assign freshness for external, time-sensitive, volatile, or unclear sources.
5. Do not publish unsupported insights.
6. Prefer updating existing pages over creating duplicates.
7. Keep the directory structure lightweight.
8. Query answers should use compiled wiki pages first when available.
9. Valuable queries should feed back into the wiki.
10. Maintenance is part of the system, not optional cleanup.
11. Update `index.md` when navigation changes.
12. Append `log.md` for significant operations.
13. Mark uncertain, unsupported, stale, volatile, or high-impact changes as `needs_review: true`.

---

## 14. Minimal Completion Checklist

Before finishing a high-value task, check:

- Did I identify the correct operating loop?
- Did I load only the relevant skill(s)?
- Did I preserve the lightweight structure?
- Did I keep raw sources immutable?
- Did I create or update a source note before learner-facing wiki updates?
- Did I preserve source traceability?
- Did I assign or check freshness where needed?
- Did I avoid creating duplicate pages?
- Did I keep concepts, source notes, insights, and query feedback distinct?
- Did I decide whether the query should be written back?
- Did I update `index.md` if navigation changed?
- Did I append `log.md` for significant operations?
- Did I mark uncertain or high-impact content for review?

If any answer is no, complete the missing step or record why it was skipped.
