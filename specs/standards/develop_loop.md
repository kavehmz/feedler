# develop_loop.md — The Develop Loop (automated spec-convergence mode)

**Status:** Operating procedure, binding where it says "binding". **Read `start.md` first** — this is an
automated wrapper around `develop <target>` (`start.md` §2/§3 case B), the independent-verification
discipline (`start.md` §4), and the change rule for spec edits (`start.md` §5). It does **not** redefine
what `develop` means; it *repeats* it in fresh agents and *gates* each pass.

**What it is.** A loop that runs `develop <target>` over and over in **fresh-context agents** until the
implementation in `workspace/` **converges** to the specs — with an **independent review gate** each
round that auto-commits only clean, spec-grounded code changes (short message, no credit) and stops the
moment anything is off. It is the self-driving form of "reconcile the code to the specs," and it
doubles as the project's **bar for modifications**: every committed change must cite a binding spec
clause.

**Runnable implementation (disposable):** `.claude/workflows/develop-loop.js`. That script is HOW; this
document is the WHAT. A better AI may regenerate the script from this doc; the rules below are the
contract it must enforce.

---

## 1. Glossary

| Term | Meaning |
|------|---------|
| **Round** | One iteration: a Develop step followed by a Gate step. |
| **Builder** | The fresh-context agent that performs one `develop <target>` reconciliation pass in a Round. Has no memory of prior Rounds. |
| **Gate** | The independent agent that reviews the Builder's uncommitted diff against the specs, then commits it or stops the loop. Never trusts the Builder's claims. |
| **Convergence** | A Round in which a fresh Builder, reading the specs and inspecting `workspace/`, finds nothing to change. The success terminal — evidence the code and specs agree. |
| **Spec defect** | A spec that is wrong, contradictory, or prescribes something incorrect. Surfaced, never silently fixed inside the loop. |

## 2. Why it exists

- **Repeated fresh passes surface what one pass misses.** Each Builder starts blind and re-derives
  conformance from the specs; successive fresh Builders catch gaps their predecessors didn't.
  Convergence (a fresh Builder finding nothing) is strong evidence the implementation conforms.
- **The gate keeps hallucination out.** An independent, adversarial reviewer that derives expectations
  from the specs *before* reading the diff, and stops on any ungrounded/incorrect/out-of-scope change,
  is what makes unattended commits safe.
- **It sets the modification bar.** The recurring worry — "is this AI finding real issues or
  hallucinating?" — is answered structurally: **every committed change cites the binding spec clause it
  satisfies**, so any commit is auditable in ~30 seconds by opening that clause. Cosmetic or
  speculative churn is rejected by the gate, not committed.

## 3. The procedure (per Round)

### 3.1 Develop step — the Builder (binding rules)

The Builder runs one `develop <target>` pass (`start.md` §3 **case B**, incremental reconciliation):
inspect `workspace/`, diff it against the specs, and change **only what genuinely diverges from a
binding clause**. It operates under these binding rules:

1. **No git mutation.** The Builder runs no `add`/`commit`/`push`/`reset`/`checkout`/`restore`/`stash`.
   It leaves its changes **uncommitted**. (Read-only `git status`/`git diff` are fine.)
2. **No spec edits.** The Builder never edits, adds, or deletes anything under `specs/`. If it concludes
   a **spec defect** exists, it does **not** touch the spec and does **not** bend the code to a buggy
   spec — it **stops and reports** the defect (the change rule, `start.md` §5: a spec change is the
   human's sign-off).
3. **No destruct/rebuild.** Surgical, in-place edits only; never delete a working implementation to
   regenerate it, never touch any `data/` directory or Docker volume, never change ports or
   container/image names.
4. **Clause-grounded only.** Every change is justified by a specific, quoted spec clause (file +
   §section). A "problem" not pinned to a binding clause is not changed — that includes cosmetic
   contract-purism that behaves identically either way.
5. **Conformance means silence.** If the code already fully conforms, the Builder makes **no changes**.
   That is the loop's success condition, not a failure to avoid — the Builder must not invent work.
6. **Build-verify.** Before finishing, the Builder confirms the build succeeds (`docker compose build`
   in `workspace/`; the project builds only via Docker) and does not leave it broken.

The Builder reports either "NO CHANGES — workspace already conforms", or a list of each change with the
clause it satisfies, plus any "SPEC DEFECT:" it found.

### 3.2 Gate step — the reviewer + committer (binding rules)

The Gate is **independent** (fresh context) and **adversarial**: it derives expected behavior from the
specs before reading the diff, and does not trust the Builder's report. Its decision, in priority order:

| Condition | Outcome |
|---|---|
| The Builder reported a spec defect, or the Gate judges one is implicated | **stop** — `spec_defect` (hand to the human; never auto-commit a spec change) |
| No uncommitted changes exist | **converged** (success terminal) |
| Any change touches `specs/` | **stop** — `spec_edit` (spec changes need the human) |
| Any workspace hunk is ungrounded, incorrect, speculative, out-of-scope, cosmetic-only churn, or destructive | **stop** — `suspicious` (leave changes uncommitted for review) |
| The build fails | **stop** — `build_failed` |
| Every workspace hunk is clause-grounded, correct, and in-scope | **clean** → commit |

On **clean**, and only then, the Gate:
1. re-verifies the build (`docker compose build`); and
2. commits **only** `workspace/` changes (`git add -A -- workspace && git commit`).

**Commit conventions (binding):**
- **Short, concise** message stating the conformance achieved (aim ≤72 chars).
- **No credit of any kind** — no `Co-Authored-By`, no "Generated with", no trailer. Just the change.
- **Only `workspace/` is staged — mechanically enforced.** Before committing, the Gate confirms the
  staged set is entirely under `workspace/` (`git diff --cached --name-only`). Any staged path outside
  it — a `specs/` change above all, **even one the environment auto-staged** — **aborts the commit and
  stops the loop** (`spec_edit`). A spec change can never be committed by the loop, and this does **not**
  rely on the Builder having obeyed §3.1 rule 2. A stopped loop hands the pending change to the human /
  orchestrator to decide (keep, revert, or turn into a proper `edit specs` session, `start.md` §5).
- **Never `git push`.** The loop is local; the operator pushes.
- Commits land on **whatever branch is checked out** — the loop does not create or switch branches.

## 4. Stop conditions & reporting

The loop ends and reports on: **converged** (no more changes); **spec_defect** / **spec_edit** (a spec
change is needed — the human decides, per the change rule); **suspicious** (a change failed the gate —
left uncommitted for review); **build_failed**; or **max rounds** (a safety cap, default 6). The report
lists every Round: its outcome, any commit hash + message, and any findings. In every case the operator
gets a clear account of what happened and what, if anything, needs their attention.

## 5. How to run it

- **Prefer a fresh/clean session.** Independence is the point — a Builder that hasn't seen the code
  being written (or the spec being authored) is the honest test of "can the specs alone drive the
  implementation to conformance."
- Invoke the runnable workflow (`.claude/workflows/develop-loop.js`) — by name (`develop-loop`) or by
  script path — optionally with `args: { target, maxRounds }` (defaults: `feedler`, `6`).
- **Prerequisite (binding):** the environment must permit `docker compose *` (build-verify) and the git
  commands the Gate uses — `git status`, `git diff`, `git add`, `git commit`, `git rev-parse`. Without
  the git permissions the loop stalls at the first commit. Nothing else is needed.

## 6. Relationship to the rest of the suite

- **`start.md` §3 case B** defines the single reconciliation pass; this loop repeats it. The Builder's
  hard rules here are the operational form of case B's "reconcile in place, don't rebuild".
- **`start.md` §4** (the four QA layers + independent verification) is honored: the Gate is the
  independent verifier, and build-verify is QA layer 1. A full `docker compose up` interaction/outcome
  pass (QA layers 2–4) remains the operator's final gate after the loop converges, per `start.md` §6.
- **`start.md` §5 + the change rule** own spec edits: the loop **never** makes them; it surfaces spec
  defects for the human. This is what keeps the specs the appreciating asset and the code the
  disposable one, even under automation.

## 7. Acceptance criteria

- A run performs Rounds of Builder→Gate until it **converges**, **stops** with a named reason, or hits
  the round cap — and returns a per-Round report (outcome, commit hash+message, findings).
- Auto-commits are **workspace-only**, atomic, **no-credit**, never pushed, and each cites the
  conformance it achieves.
- The loop **never** edits or commits `specs/`; a suspected spec defect stops it for the human.
- A suspicious/ungrounded/destructive change is **stopped, not committed**, with its changes left in the
  working tree for review.
- Convergence leaves `workspace/` build-passing and conformant to the specs.

## 8. Deliverables checklist

- [ ] This document (`specs/standards/develop_loop.md`) — the durable, normative definition.
- [ ] `start.md` references the loop (command grammar + boot table) so it is discoverable.
- [ ] The runnable workflow `.claude/workflows/develop-loop.js` enforces §3's Builder and Gate rules
      and §3.2's commit conventions.
- [ ] The git + docker permissions the loop needs are documented (§5) so a clean-session run does not
      stall.
