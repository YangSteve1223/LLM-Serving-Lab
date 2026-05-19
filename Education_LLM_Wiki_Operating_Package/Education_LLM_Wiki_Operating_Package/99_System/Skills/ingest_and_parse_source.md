# Skill: ingest_and_parse_source.md

## Purpose

Use this skill for the first half of the Source Loop:

```text
Intake → Triage → Parse
```

The goal is to turn raw material into a structured, source-traceable source note without prematurely creating learner-facing wiki pages.

---

## When to Use

Use this skill when:

- the user provides a new article, PDF, transcript, lecture note, webpage, dataset, or pasted source;
- a raw source appears in `90_Raw_Sources/`;
- the user asks to process or add a source to the wiki;
- an existing source needs to be parsed into reusable evidence.

---

## Inputs

Possible inputs:

- raw source file path;
- pasted source text;
- source title or URL;
- user-provided context;
- existing source note to update.

---

## Step 1 — Intake

Preserve the raw material.

Actions:

1. If the source is a file or pasted text, save or reference it under `90_Raw_Sources/` when performing a wiki update.
2. Assign a stable `source_id`.
3. Do not rewrite or clean the raw source in place.
4. If the source is external and not copied into the vault, record the URL or reference clearly.

Suggested source ID format:

```text
source_YYYYMMDD_short-title
```

Example:

```text
source_20260425_ai-tutoring-review
```

---

## Step 2 — Triage

Before parsing deeply, classify the source.

Answer these questions:

```yaml
source_type:
source_owner:
topic_relevance:
freshness:
processing_decision:
priority:
reason:
```

### Source type options

Use the closest option:

- `lecture_slide`
- `transcript`
- `syllabus`
- `assignment`
- `paper`
- `webpage`
- `dataset`
- `book_chapter`
- `report`
- `query_feedback`
- `other`

### Source owner options

Use the closest option:

- `teacher`
- `institution`
- `author`
- `external_publisher`
- `platform`
- `student`
- `unknown`

### Freshness options

Use:

- `stable`
- `time_sensitive`
- `volatile`
- `unknown`

Rules:

1. Teacher course materials may be stable inside the course context, but still require source metadata.
2. External webpages, AI tools, policies, rankings, datasets, prices, market information, and current statistics should not default to stable.
3. If unsure, use `freshness: unknown` and `needs_review: true`.
4. If `freshness` is `time_sensitive` or `volatile`, include `last_checked`, `next_review`, and `review_reason`.

### Processing decision options

Use one or more:

- `save_raw_only`
- `create_source_note`
- `update_existing_source_note`
- `update_concept_after_parse`
- `update_learning_map_after_parse`
- `create_or_update_insight_after_parse`
- `needs_human_review`
- `do_not_process`

---

## Step 3 — Parse

Create or update a source note in `03_Source_Notes/`.

Separate **what the source says** from **what the agent infers**.

Extract:

1. source summary;
2. source metadata;
3. key concepts;
4. key claims;
5. useful evidence, quotations, data points, examples, or references;
6. limitations, uncertainty, or possible bias;
7. related concept pages;
8. possible insights;
9. suggested wiki updates.

---

## Output

Create or update one source note using `99_System/Templates/Source_Note_Template.md`.

Preferred output path:

```text
03_Source_Notes/source_YYYYMMDD_short-title.md
```

---

## Handoff

After the source note is created:

1. If the source only needs archival evidence, stop and call `integrate_and_record.md`.
2. If it supports reusable concepts, call `compile_wiki_pages.md`.
3. If it changes navigation, call `integrate_and_record.md`.
4. If it reveals uncertainty, mark `needs_review: true`.

---

## Quality Checklist

Before finishing:

- Is the raw source preserved or clearly referenced?
- Is `source_id` stable?
- Is `source_type` recorded?
- Is `source_owner` recorded when known?
- Is `freshness` assessed?
- Are claims separated from interpretation?
- Are key concepts and evidence extracted?
- Are limitations recorded?
- Are suggested wiki updates clear?
- Is the source note not pretending to be a learner-facing concept page?
