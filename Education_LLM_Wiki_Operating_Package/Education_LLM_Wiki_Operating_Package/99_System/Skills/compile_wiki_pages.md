# Skill: compile_wiki_pages.md

## Purpose

Use this skill to transform parsed evidence into reusable wiki pages.

It covers the Compile stage in the Source Loop and the page-update part of the Query Loop.

```text
source note / query feedback → concept page / learning map / insight
```

---

## When to Use

Use this skill when:

- a source note contains reusable concepts;
- multiple source notes point to the same concept;
- a learner-facing concept explanation is missing or weak;
- a learning route needs to be created or updated;
- a query produces a reusable synthesis;
- a cross-source pattern, contradiction, gap, or method emerges.

---

## Inputs

Possible inputs:

- one or more source notes;
- query feedback entry;
- existing concept page;
- existing learning map;
- existing insight;
- user instruction about desired output.

---

## Page Boundary Rules

Choose the correct page type.

### Create or update a Core Concept when the question is:

> What is this concept, why does it matter, and how should a learner understand it?

Preferred location:

```text
02_Core_Concepts/
```

Use `Core_Concept_Template.md`.

### Create or update a Learning Map when the question is:

> How should a learner enter this topic, in what sequence, and with what prerequisites?

Preferred location:

```text
01_Learning_Maps/
```

Use `Learning_Map_Template.md`.

### Create or update an Insight when the question is:

> What pattern, principle, contradiction, gap, or transferable method emerges across sources or concepts?

Preferred location:

```text
04_Insights/
```

Use `Insight_Template.md`.

---

## Compile Rules

1. Preserve `source_ids` from source notes or query feedback.
2. Do not invent unsupported claims.
3. If sources conflict, preserve the conflict instead of forcing a false synthesis.
4. Prefer updating existing pages over creating duplicates.
5. Use wiki links for related pages.
6. Keep learner-facing pages clear and reusable.
7. Do not paste long source-by-source summaries into concept pages. Put source details in source notes.
8. Put common confusions inside concept pages, not in a separate folder.
9. Put transfer applications inside insight pages, not in a separate folder.
10. Mark high-impact, uncertain, or source-light pages as `needs_review: true`.

---

## Freshness During Compile

When compiling, inherit or reassess freshness:

1. If the compiled page depends mainly on foundational theory, use `freshness: stable`.
2. If it depends on external tools, policies, statistics, market reports, model rankings, or current product features, use `freshness: time_sensitive` or `volatile`.
3. If the page combines stable theory with volatile examples, mark the volatile parts explicitly.
4. If unsure, use `freshness: unknown` and `needs_review: true`.

---

## Output

Possible outputs:

```text
01_Learning_Maps/topic_name.md
02_Core_Concepts/concept_name.md
04_Insights/insight_name.md
```

After creating or updating pages, call `integrate_and_record.md` if:

- a new page was created;
- page links changed;
- navigation changed;
- a high-value query was written back;
- an existing page was materially updated.

---

## Quality Checklist

Before finishing:

- Did I choose the correct page type?
- Did I update an existing page instead of creating a duplicate when appropriate?
- Did I preserve `source_ids`?
- Did I link related concepts, insights, or learning maps?
- Did I separate source evidence from synthesis?
- Did I mark uncertainty and freshness correctly?
- Did I avoid over-fragmentation?
- Did I call `integrate_and_record.md` when index/log may need updates?
