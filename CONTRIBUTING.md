# Contributing

**The most useful thing you can send is a lineage correction.** Details below — but first:

## Credit where it belongs

The price data comes from **[`jvrck/openrouterlist`](https://github.com/jvrck/openrouterlist)** by
[Jim Vrckovski (@jvrck)](https://github.com/jvrck), who has snapshotted OpenRouter every 12 hours
since September 2024. If your issue is with a **price, a date, or a missing model**, it is almost
certainly upstream — please raise it there, and go star the repo while you're at it. If your issue
is with how this project *groups or draws* those models, it belongs here.

---

## Lineage decisions are judgement calls, and we would like yours

This is the part that most needs outside eyes — **especially from people who work at the labs whose
models are on the chart.**

Model lineages in [`config/families.yaml`](config/families.yaml) are **declared by hand, not
inferred**. Auto-parsing model ids misgroups `gpt-5.6-luna`, `kimi-k2.7-code`,
`claude-opus-4.7-fast` and every `:thinking` variant, so a human decides:

- which models form one **succession** (each generation replacing the last),
- which are **variants** (`:thinking`, `-fast`) that sit outside the sequence,
- and where a generation **forks** into tiers (GPT-5.6 → Sol / Terra / Luna).

Some of those calls are genuinely debatable, and **a few are probably wrong.** A sample of the ones
we are least sure about:

| Call we made | Why it's arguable |
| --- | --- |
| `gpt-5.6-sol` continues the flagship line; `terra` and `luna` fork off | Sol inherits GPT-5.5's exact price, so we treated it as the successor. If OpenAI considers Terra the "real" 5.6, the spine is on the wrong tier. |
| `gpt-5.6-luna` continues the **mini** line | Luna is both a 5.6 tier *and* the cheap tier. It has two plausible parents and we picked one. |
| `claude-fable-5` is a new tier above Opus, not an Opus successor | It launched while Opus 4.8 was still current, at 2× the price — but that is inference from pricing, not a statement from Anthropic. |
| `deepseek-chat` → `deepseek-chat-v3-0324` → `deepseek-chat-v3.1` → … as one line | Dated snapshots vs. genuine generations is a fuzzy boundary. |
| `qwen3-max-thinking` is a *variant*, not a generation | Same for `kimi-k2-thinking`. Reasoning modes may deserve their own lineages. |

**If you maintain one of these model families, you are the authority and we will take your word for
it.** A one-line issue saying "Terra is the flagship, Sol is the premium tier" is worth more than
any amount of guessing on our side.

### Sending a correction

Either is fine — an issue costs you less, so don't feel obliged to open a PR:

- **[Open a lineage issue](https://github.com/rjalexa/llmprices/issues/new?template=lineage.yml)** —
  just say what's wrong and what it should be.
- **Open a PR** editing `config/families.yaml`. List order *is* generational order. Ingest fails
  loudly if an id isn't in the ledger, so a typo can't slip through:

  ```bash
  uv run --project backend atlas validate
  uv run --project backend atlas ingest
  uv run --project backend python -m pytest backend/tests -q
  ```

  If your change alters the roster counts, `backend/tests/test_acceptance.py` will tell you exactly
  which numbers moved — update them in the same PR.

---

## Other contributions

Also welcome: chart legibility problems (label collisions, unreadable colour pairs), accessibility
issues, and additional model families.

Before pushing:

```bash
uv run --project backend python -m pytest backend/tests -q   # backend
pnpm --dir frontend test                                     # selection-state store
pnpm --dir frontend exec tsc -b                              # types
```

Two conventions worth knowing:

- **Colours are capped at 8 selected families** and validated for colour-vision deficiency. Adding a
  ninth hue is not a fix — see the colour section in the README.
- **The chart must not assume prices fall.** Several generations got *more* expensive
  (`kimi-k2.6 → k3` is +216%), and styling or copy that treats a rise as an anomaly is a bug.

By contributing you agree your work is licensed under the [MIT Licence](LICENSE).
