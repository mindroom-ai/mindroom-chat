# CINNY-003g Plan Debate

Two plans exist for fixing intermittent AI summary display:
- `PLAN.md` (Agent A) — IndexedDB cache approach
- `PLAN-B.md` (Agent B) — Proactive fetch approach

## Your Task
1. Read both plans carefully
2. Compare: correctness, complexity, reliability, performance
3. Write `DEBATE.md` with comparison, recommended approach (can be hybrid), implementation order

## Key context
- Root cause agreed: thread events aren't in room timeline; unopened threads have empty `.events`
- Plan A: persistent IndexedDB cache decoupled from timeline loading
- Plan B: proactive `fetchRelations` for visible thread roots missing summary data
- Consider: which is simpler? Which handles edge cases better? Which survives page reloads?
