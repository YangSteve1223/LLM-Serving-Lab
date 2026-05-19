# Education LLM Wiki Operating Package

This package contains a lightweight AGENTS.md + Skills setup for an Education LLM Wiki.

## Core Design

The wiki runs through three operating loops:

1. Source Loop: `Intake → Triage → Parse → Compile → Integrate → Record`
2. Query Loop: `Query → Retrieve → Answer → Reflect → Write Back → Record`
3. Maintenance Loop: `Audit → Diagnose → Repair → Review → Record`

## Skills

The package uses five lightweight skills:

1. `ingest_and_parse_source.md`
2. `compile_wiki_pages.md`
3. `answer_query_and_writeback.md`
4. `lint_and_repair_wiki.md`
5. `integrate_and_record.md`

Freshness control is embedded across these skills instead of being a separate skill.
