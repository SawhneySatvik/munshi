# Architecture diagram

Mermaid source (GitHub renders it). The prose is in [ARCHITECTURE.md](ARCHITECTURE.md). Boxes are code or database
objects at `c30c079`; the one dashed box is the only thing outside this repository.

```mermaid
flowchart TB
  person["Owner / manager / staff<br/>phone or counter browser"]
  subgraph web["apps/web (Next.js, one server process)"]
    screens["Screens and server actions<br/>sessionFrom(): the ONE place a Session is made"]
    port["agent-port.ts<br/>binds one tenant + one run"]
  end
  subgraph core["packages/core (framework-free, pool: munshi_app)"]
    cmds["Commands: sale.record, purchase.record,<br/>stock.count, reorder.place ..."]
    appr["proposeDraft / decide<br/>(approver = the session's member)"]
    snaps["mintSnapshot: named reads -> snap.* cells"]
    watch["Watchers (no actor)"]
  end
  subgraph agent["packages/agent (pool: munshi_agent, read-only)"]
    run["ask / explainFinding / draftFix / narrateBrief<br/>router -> desk -> narrate"]
    photo["countShelf / readBill / askByVoice / readAloud<br/>draftReply / draftOrder / writeCampaignCopy"]
    check["cite-or-abstain validator<br/>answer.ts + words.ts"]
  end
  subgraph ai["packages/ai (no database, no agent logic)"]
    adapters["providers: generate, anthropic, meta-sam, meta-voice,<br/>sarvam voice / speak / docs<br/>roles -> alias -> provider/model (config.ts, models.ts)"]
  end
  models[["Model providers<br/>Meta: Muse Spark . SAM 3.1 . Voice Transcribe . Spark Open on Baseten<br/>(not yet called live: TO-MEASURE)<br/>Gemini . Sarvam . Anthropic . OpenAI . OpenRouter . NVIDIA<br/>(probed live 31 Oct)"]]:::ext
  subgraph pg["Postgres: forced RLS, SET LOCAL context"]
    ops["ops: shelf_count, bill_read, bill_line<br/>ai: run, trace, finding"]
    appv["approval: draft, decision"]
    snapt["snap: snapshot (typed cells, immutable)"]
    books["books.* (append-only)<br/>BOOK GUARD trigger on every table"]
    audit["audit.audit_log<br/>per-tenant hash chain"]
    views["agent_view.*: names and ids, no numbers"]
  end

  person --> screens
  screens --> cmds
  screens --> appr
  screens --> run
  screens --> photo
  run --> port
  photo --> port
  port -- "read / evidence / propose (bound closures)" --> snaps
  port --> appr
  port -- "resolve a ref (munshi_agent)" --> snapt
  port -- "resolve a ref (munshi_agent)" --> views
  run --> adapters
  photo --> adapters
  adapters -. "HTTPS, or replay of recorded fixtures" .-> models
  run --> check
  cmds --> books
  appr -- "one transaction, approver's identity" --> books
  snaps --> snapt
  watch --> snaps
  watch --> ops
  appr --> appv
  books --> audit

  classDef ext stroke-dasharray: 5 5
```

Reading the arrows. Nothing in `packages/agent` has an arrow to `books` or to a writer: its only way to change anything
is `propose`, which becomes a row in `approval.draft` that waits for a person. The only arrows into `books` are a
person's own command and `decide()` run on an approver's request; the guard trigger on the table checks both.
