# Skill: lint_and_repair_wiki.md

## Purpose

Use this skill for the Maintenance Loop:

```text
Audit → Diagnose → Repair → Review
```

The goal is to keep the wiki healthy, navigable, evidence-backed, fresh, and not over-fragmented.

---

## When to Use

Use this skill when:

- several sources have been ingested;
- several high-value queries have been written back;
- the index feels outdated;
- a contradiction or stale claim is suspected;
- duplicate pages or orphan pages appear;
- source traceability is unclear;
- the user asks for a system review;
- scheduled maintenance is due.

---

## Inputs

Possible inputs:

- `index.md`;
- `log.md`;
- pages in `01_Learning_Maps/`, `02_Core_Concepts/`, `03_Source_Notes/`, `04_Insights/`, `05_Query_Feedback/`;
- previous `99_System/Lint_Report.md`.

---

## Step 1 — Audit

Check for:

### Source and evidence issues

- pages without `source_ids` where source support is expected;
- source notes without `source_types` or `source_owners` when available;
- insights without traceable source notes;
- unsupported claims in learner-facing pages.

### Freshness issues

- external source notes without freshness assessment;
- volatile or time-sensitive pages missing `last_checked` or `next_review`;
- pages whose `next_review` date has passed;
- pages marked `stable` but relying mainly on fast-changing external information;
- `freshness: unknown` pages left unresolved for too long.

### Structure and navigation issues

- orphan pages with no inbound links;
- missing cross-links between learning maps, concepts, source notes, and insights;
- important concepts mentioned repeatedly but lacking a concept page;
- index entries that are outdated or missing;
- log entries that are missing or inconsistent.

### Over-fragmentation issues

- duplicated concept pages;
- source notes that never affect the wiki;
- separate pages that should be sections inside existing pages;
- pages that only contain minor misconceptions, examples, or prompts.

### Query feedback issues

- query feedback entries that were logged but never acted on;
- recurring learner questions not reflected in concept pages;
- useful query insights not added to learning maps or insights.

---

## Step 2 — Diagnose

Classify each issue by type and severity.

Issue types:

- `missing_source_trace`
- `stale_freshness`
- `unsupported_insight`
- `duplicate_page`
- `orphan_page`
- `missing_link`
- `missing_concept`
- `index_outdated`
- `log_gap`
- `query_not_written_back`
- `needs_human_review`

Severity:

- `critical` — threatens trust, correctness, or navigation;
- `medium` — affects usefulness or maintainability;
- `low` — minor cleanup.

---

## Step 3 — Repair

Allowed repair actions:

- add missing links;
- update frontmatter;
- mark `needs_review: true`;
- mark page status as `outdated`, `disputed`, `duplicate`, `archived`, or `draft`;
- suggest merge;
- suggest archive;
- update index;
- update lint report;
- append log entry.

Do not silently delete pages.

Only merge or archive pages when the action is obvious and logged.

---

## Step 4 — Review

Mark `needs_review: true` when:

- source support is unclear;
- the page contains high-impact insight;
- the page changes a concept boundary;
- conflicting sources exist;
- freshness is stale or unknown;
- external current information is central;
- the repair is uncertain.

---

## Output

Create or update:

```text
99_System/Lint_Report.md
```

Use `Lint_Report_Template.md`.

Then call `integrate_and_record.md` to update index/log if needed.

---

## Quality Checklist

Before finishing:

- Did I check source traceability?
- Did I check freshness?
- Did I check duplicate and orphan pages?
- Did I check index/log consistency?
- Did I check unresolved query feedback?
- Did I avoid silent deletion?
- Did I mark uncertainty for review?
- Did I produce clear repair actions?
- Did I call `integrate_and_record.md` for log/index updates?
