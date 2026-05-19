# Skill: answer_query_and_writeback.md

## Purpose

Use this skill for the Query Loop:

```text
Query → Retrieve → Answer → Reflect → Write Back → Record
```

The goal is to answer the learner using the compiled wiki first, then decide whether the query should improve the wiki.

---

## When to Use

Use this skill when:

- the user asks a question about a topic covered by the wiki;
- the user asks for explanation, comparison, synthesis, decision support, or learning path;
- the user asks what the wiki knows about a topic;
- the user asks a question that may expose a gap in the wiki.

---

## Inputs

Possible inputs:

- user query;
- `index.md`;
- relevant learning maps;
- relevant concept pages;
- relevant source notes;
- relevant insights;
- `05_Query_Feedback/Query_Inbox.md`.

---

## Step 1 — Query

Classify the user intent:

- conceptual explanation;
- comparison;
- learning path;
- source-based summary;
- synthesis;
- decision support;
- review or critique;
- system maintenance request;
- unclear or mixed intent.

If the query is answerable with existing wiki knowledge, use the wiki first.

---

## Step 2 — Retrieve

Read `index.md` first when using the wiki.

Then identify relevant pages from:

- `01_Learning_Maps/`
- `02_Core_Concepts/`
- `03_Source_Notes/`
- `04_Insights/`
- `05_Query_Feedback/`

If the wiki is insufficient, say what is missing and avoid pretending certainty.

---

## Step 3 — Freshness Check

Before answering, check whether relevant pages are stale or time-sensitive.

Ask:

1. Is the answer based on external, current, or volatile information?
2. Are related pages marked `time_sensitive`, `volatile`, or `unknown`?
3. Has `next_review` passed?
4. Does the user ask for latest/current/recent information?

If yes:

- mark uncertainty clearly;
- update freshness metadata if performing a wiki update;
- mark `needs_review: true` when necessary.

---

## Step 4 — Answer

Answer in a learner-facing way.

Rules:

1. Be direct and structured.
2. Use Chinese by default unless the user asks otherwise.
3. Avoid overlong source summaries unless requested.
4. Distinguish wiki-supported claims from inference.
5. If the wiki is incomplete, explain the gap.
6. If the query asks for a reusable framework, make it easy to write back.

---

## Step 5 — Reflect

Before finishing a high-value query, decide whether it should write back.

Write-back decision questions:

1. Does this query reveal a missing concept?
2. Does it reveal a weak explanation?
3. Does it reveal a common confusion?
4. Does it suggest a better learning map?
5. Does it expose a source/evidence gap?
6. Does it produce a reusable insight?
7. Does it reveal stale or time-sensitive knowledge?
8. Would future learners ask a similar question?

---

## Step 6 — Write Back

If valuable, append to `05_Query_Feedback/Query_Inbox.md` using `Query_Feedback_Template.md`.

If the query directly improves a concept, learning map, or insight, call `compile_wiki_pages.md`.

If navigation or log changes are needed, call `integrate_and_record.md`.

Not every query needs a separate page. Use `Query_Inbox.md` as the default lightweight place.

---

## Output

Possible outputs:

- user-facing answer;
- query feedback entry;
- updated concept page;
- updated learning map;
- updated insight;
- log entry for high-value queries.

---

## Quality Checklist

Before finishing:

- Did I read the relevant wiki layer instead of only relying on chat memory?
- Did I check whether the information might be stale?
- Did I state gaps or uncertainty?
- Did I answer the user directly?
- Did I decide whether the query should be written back?
- Did I update or suggest updates to the wiki if the query is reusable?
- Did I call `integrate_and_record.md` when needed?
