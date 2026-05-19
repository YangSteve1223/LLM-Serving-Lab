# Skill: integrate_and_record.md

## Purpose

Use this skill as the shared closing skill for all operating loops.

It covers:

```text
Integrate → Record
```

The goal is to merge changes into the existing wiki structure, preserve links and source traceability, update navigation, and append operation history.

---

## When to Use

Use this skill after:

- a source note is created or updated;
- a concept, learning map, or insight is created or updated;
- a high-value query is written back;
- a lint pass produces findings;
- a page is renamed, merged, archived, or marked for review;
- navigation changes.

---

## Inputs

Possible inputs:

- created pages;
- updated pages;
- source notes;
- query feedback entries;
- lint report;
- `index.md`;
- `log.md`.

---

## Step 1 — Integrate

Check whether the update fits the existing wiki.

Ask:

1. Does this duplicate an existing page?
2. Should this be a new page or a section inside an existing page?
3. Are source IDs inherited correctly?
4. Are related pages linked?
5. Does a learning map need to point to this page?
6. Does an insight need to cite this concept or source note?
7. Does this update change navigation?
8. Does this update introduce uncertainty, conflict, or stale information?

---

## Step 2 — Maintain Links

Add or update links between:

- learning maps and concept pages;
- concept pages and source notes;
- concept pages and insights;
- query feedback and pages it affects;
- index and all important pages.

Use wiki links where possible:

```md
[[Page Title]]
```

---

## Step 3 — Update Index

Update `index.md` when:

- a new page is created;
- a page is renamed;
- a page is archived;
- a learning map changes;
- a major concept becomes central;
- query feedback produces reusable wiki changes;
- lint identifies navigation issues.

Index entry format:

```md
- [[Page Title]] — one-line description. type: concept. status: draft.
```

Do not turn index into a raw source list. It should support learner navigation.

---

## Step 4 — Append Log

Append to `log.md` for significant operations.

Do not rewrite historical entries unless corrupted.

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

## Step 5 — Review Flags

Mark pages as `needs_review: true` when:

- source support is missing or unclear;
- freshness is unknown, stale, volatile, or time-sensitive;
- the update is high-impact;
- the page changes a concept boundary;
- there is a contradiction;
- human confirmation is needed.

---

## Output

Possible outputs:

- updated `index.md`;
- appended `log.md`;
- updated cross-links;
- updated review flags;
- summary of pages created/updated.

---

## Quality Checklist

Before finishing:

- Are new or updated pages linked from somewhere?
- Is index updated if navigation changed?
- Is log appended if the operation is significant?
- Are source IDs preserved across derived pages?
- Are freshness and review flags preserved?
- Are duplicate pages avoided?
- Are unresolved issues made visible rather than hidden?
