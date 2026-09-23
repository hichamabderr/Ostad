# Production review: Mueen Al-Ostad (معين الأستاذ)

**Date:** 2026-09-23
**Scope:** `https://ostady.vercel.app` (production deployment `ostad-77lt30fkm`, commit `1cba375`), the repo at `main`, and the Supabase migrations.
**Method:**
- Walked every route live with a fresh test account.
- Created real data (a class, 3 students, a session, attendance, and a grade), reloaded after each step to confirm it persisted, then deleted it.
- Captured network traffic and read the rows back from Supabase REST under the user's own token.
- Did a static review of the sync engine, components and SQL migrations.
- Ran `npm run lint` and `npm run test`.

**Not covered:**
- The Supabase advisors (`get_advisors`). The MCP tools weren't loaded in this session, so the schema findings below come from reading the migrations.
- Vercel runtime error logs (`vercel logs` timed out).
- `npm run build`.
- Excel/Moumtaze import with real files.
- A second device or concurrent editing.

---

## 1. Verdict

**Not yet solid enough for real teachers' data.** The UI is complete and polished, and the basic save → reload path works for adding and editing data. But I reproduced a **data-integrity bug in deletion**: removing your last class appears to work, the server confirms it, and the class comes back after a reload. There is also a **privacy/branding problem**: every new account starts with another teacher's school, wilaya, birth date and marital status, and these flow into official exported documents.

Fix the two Critical items in §3 and add a regression test for each before onboarding users. Nearly everything else is Medium or Low polish.

### Top risks
1. A deleted roster comes back after reload (Critical, reproduced).
2. New workspaces are pre-filled with a real person's profile data (Critical, observed live).
3. A migration that was already applied was edited in place; the "resilient roster import" never reached the database (High).
4. Some sync tables lack workspace ownership checks: `dashboard_tasks` and `sync_operations` accept any `workspace_id` (High).
5. "Retry" can show a false sync failure after the writes succeeded (Medium).

### Strengths
- Clean route-per-workspace architecture. Every route renders; no console errors; no horizontal overflow at 466 px mobile width.
- A thoughtful sync design: delta outbox, revisions, tombstones, operation ledger, device echo cancellation.
- RLS is enabled on all 19 tables, and policies use the initplan-friendly `(select auth.uid())`.
- Good empty states with clear next actions. Weekly-hours rule is visible when creating a class (1 h for 1 ج.م علوم, 2 h otherwise).
- Good baseline security headers (HSTS preload, `X-Frame-Options`, `nosniff`, `Permissions-Policy`). Lint is clean and 56/56 tests pass.

---

## 2. What was tested live

| Route | Renders | Data test | Result |
|---|---|---|---|
| `/dashboard` | ✓ | Onboarding checklist, stats | OK |
| `/classes` | ✓ | Create class → reload | Persisted ✓ |
| `/classes` | ✓ | Delete class → reload | **Class comes back ✗** (§3.1) |
| `/students` | ✓ | Paste 3 names → reload | Persisted ✓ |
| `/attendance` | ✓ | New session, 1 absence, 1 participation → reload | Persisted ✓ |
| `/grades` | ✓ | Enter 25, then 14.5 → reload | 25 silently dropped; 14.5 persisted ✓ |
| `/sessions` | ✓ | Curriculum units listed for 3AS | OK |
| `/council` | ✓ | Empty statistics | OK |
| `/documents` | ✓ | Preview includes the test session and the absence | OK (cross-feature data flows) |
| `/timetable`, `/annual-distribution`, `/curriculum`, `/lesson-preparation`, `/settings` | ✓ | Visual/DOM only | OK, see UX notes |

Sync indicator: it moved `قيد المزامنة` → `متزامن` after every write. All Supabase calls returned 2xx.

---

## 3. Findings

### 3.1 CRITICAL: a deleted roster comes back after reload

**How to reproduce:**
1. Have a single class with students.
2. Delete the class and confirm.
3. The UI shows 0 classes; the network shows a tombstone upsert and `DELETE classes` → **204**; the status shows `متزامن`.
4. Reload the page. The class and all 3 students are back, and the attendance session too.

I read the tables back under the user's own token: `classes = []`, `students = []`, `attendance = []`. **The server is correct; the client brings the data back.**

**Root cause.** Three safeguards added in `1cba375` together make "empty roster" a state the client refuses to accept:
- `hooks/useCloudAppState.ts:377`: the cache-save effect returns early when `classes` and `students` are both empty, so the stale IndexedDB snapshot is never replaced.
- `lib/state-cache.ts` (`saveAppStateCache`): also refuses to write an empty roster over a non-empty cache.
- `hooks/useCloudAppState.ts:325-330`: on load, if the remote has 0 classes and the cache has some, it "preserves the local roster" and shows it as the truth. This branch also leaves `lastSyncedStateRef` untouched.

**Likely worse (not yet verified):** because of that last branch, the next edit may diff the resurrected roster against an empty baseline and **upload it back to Supabase**. That would undo the user's delete on the server too. The same logic means a delete on phone A is undone by the stale cache on laptop B.

**Suggested fix:**
- Stop inferring intent from "the roster is empty". Supabase is the source of truth (`AGENTS.md`): after a successful remote load, always replace the cache with the remote state.
- If you want protection against an accidental wipe, key it on something explicit. Two options:
  - Keep local data only when the outbox still holds unacknowledged operations for those entities.
  - Or use `cloudRevision`: keep local only if the local revision is newer than the remote one.
- Remove the empty-roster guards in both the effect and `saveAppStateCache`, or reduce them to "never write *demo* state".

**Regression test:** delete the last class → reload → expect 0 classes. Also: remote empty, cache non-empty, outbox empty → the remote state wins.

### 3.2 CRITICAL: new accounts inherit a real person's profile

A brand-new account opened on:
- School **ثانوية الدكتور بن زرجب**, wilaya **تلمسان**
- **7 years' experience**
- Birth date 1988-06-15, married, male

Source: `DEFAULT_PROFILE` in `lib/storage.ts:251-268`. These values show up in:
- The class list header (`components/ClassesManager.tsx:1336`)
- Settings and the professional card
- Every exported `.doc` header, e.g. the Documents preview: "المؤسسة: ثانوية الدكتور بن زرجب"

A teacher who doesn't notice will print official documents under someone else's school.

**Related hard-coded values:**
- `app/page.tsx:368`: the global footer always reads "ثانوية الدكتور بن زرجب - تلمسان", whatever the user's school.
- Fallbacks `|| "ثانوية الدكتور بن زرجب"` and `|| "هشام عبد الرحيم"`: `components/AnnualDistribution.tsx:444`, `components/ProfessionalProfile.tsx:167,278,291`.
- Placeholders with the developer's real name and email (`ProfessionalProfile.tsx:441-613`, e.g. `placeholder="hichamdevpro@gmail.com"`).

This breaks the rule "ابدأ مساحة المستخدم فارغة" and leaks personal data.

**Fix:**
- Empty strings or `undefined` for every personal field in `DEFAULT_PROFILE`.
- Render the footer from `state.profile`.
- Use neutral placeholders (e.g. "اسم المؤسسة", "name@example.com").
- Have exports show a visible warning ("أكمل بيانات المؤسسة في الإعدادات") when the school name is empty.

### 3.3 HIGH: migrations edited after they were applied

- Commit `1cba375` changed both `20260921071000_atomic_roster_import.sql` and `20260922080000_resilient_roster_import.sql`. The two files are now **byte-identical** (same md5).
- Supabase won't re-run a migration version that is already recorded. So production runs whatever was applied first; nothing in git proves the `on_conflict` change reached the database, and a fresh environment builds a different database.
- Separately, `upsert_grade` (`20260920210000_foundation_reset.sql:225`) runs `select workspace_id … from public.workspaces`, but that column is `id`. The function will fail on every call. It's unused by the app but still granted to `authenticated`.

**Fix:**
- Never edit applied migrations. Add a new timestamped migration containing the intended `import_roster_batch`.
- Drop or fix `upsert_grade`.
- Compare the live function definitions against git (`supabase db diff`, or `pg_get_functiondef` via MCP).

### 3.4 HIGH: workspace ownership not enforced on two tables

- `dashboard_tasks` and `sync_operations` reference `workspaces(id)` only (`20260920230000_dashboard_tasks.sql:13`, `20260921072000_sync_operation_ledger.sql:7`). All other tables use the composite `(workspace_id, owner_id) → workspaces(id, owner_id)`.
- RLS only checks `owner_id`, so a user can insert rows carrying *another* user's `workspace_id`.
- `claim_sync_operation` also doesn't verify that the workspace belongs to the caller, and `p_owner_id <> auth.uid()` evaluates to NULL (skipping the check) when `auth.uid()` is NULL.
- **Impact:** an attacker who learns a victim's workspace UUID can pre-claim operation IDs in that workspace (the victim's writes are then silently skipped as "already applied"). They can also take `task_id`s in it. UUIDs are hard to guess, which is why this is High rather than Critical.

**Fix:**
- Use the composite FK on both tables.
- In `claim_sync_operation`, add `if not exists (select 1 from workspaces where id = p_workspace_id and owner_id = auth.uid()) then raise …`, plus `if auth.uid() is null then raise …`.
- `revoke execute … from public, anon`.

### 3.5 MEDIUM: sync UX

- **False failure after retry.** In `hooks/useCloudAppState.ts:583-615`, once the outbox has flushed successfully, `retrySync()` does an extra `loadCoreState` read. If that read fails, the status is set to `sync-failed`, although every write was acknowledged. Fix: set `ready` once the outbox is empty, and treat the refresh failure as a soft warning.
- **Retry shown during normal saves.** `components/TopHeaderSanad.tsx:204` shows "إعادة المحاولة" for every non-ready status, including `sync-pending`, so it flashes on each edit. Show it only for `sync-failed` and `local-only`; conflicts should open the conflict dialog instead.
- The "جارٍ حفظ التغييرات..." toast on every tap adds noise during a live lesson (e.g. attendance). The header dot is enough; keep toasts for failures.
- `sync_tombstones` isn't in the realtime publication (`20260920230200_realtime_sync_tables.sql`), so other open devices only see deletions on their next full load.

### 3.6 MEDIUM: grades and evaluation

- **Out-of-range grades are silently ignored.** Typing `25` does nothing, with no message (`components/GradesAndEvaluation.tsx:424` just `return`s). Show an inline error ("العلامة بين 0 و20").
- **Duplicate option in the appreciation dropdown.** "نتائج ممتازة" appears twice because the EXCELLENT and VERY_GOOD tiers share the same estimation (`lib/pedagogical-evaluations.ts:33-50`). Deduplicate the option list, or give VERY_GOOD its own wording (e.g. "نتائج جيدة جداً").
- The grade inputs' accessible name is just "-" (the placeholder). Add `aria-label="التقويم المستمر – {student}"` and similar.

### 3.7 MEDIUM: accessibility

- Attendance toggles (الغياب / الكراس / شغب / مشاركة) expose no state: `aria-pressed` is used nowhere in `components/`. Screen-reader users can't tell whether a student is marked absent.
- The paste-names modal's close button has no accessible name.
- Touch targets under 32 px, counted on a 466 px viewport:

  | Page | Targets |
  |---|---|
  | `/curriculum` | 72 |
  | `/settings` | 16 |
  | `/lesson-preparation` | 8 |
  | `/students` | 7 |
  | `/grades` | 5 |
  | `/documents` | 5 |

  Aim for at least 40–44 px on mobile.
- Many form inputs in Settings have no `<label for>` association; their only visible hint is the placeholder.

### 3.8 LOW: copy and consistency

- "قائمة الأقسام التي تدرسها في **ثانوية ثانوية** الدكتور بن زرجب": the prefix is added to a name that already starts with "ثانوية" (`ClassesManager.tsx:1336`). Drop the hard-coded prefix.
- The dashboard checklist marks step 1 "حذف بيانات البداية" as complete for a brand-new user who never had demo data. Hide it when there's nothing to delete.
- The backup button in the sidebar is labelled "تصدير نسخة احتياطية" but its visible text is "حفظ محلي". Use one term.
- Hardcoded Tailwind palette colours are still common (`text-slate-700`, `bg-emerald-50`, and `colorClass` in `pedagogical-evaluations.ts`), against the design-token rule. Not hex, but it bypasses `globals.css`.

### 3.9 LOW: code and repo hygiene

- `ADMIN_EMAIL` in `app/page.tsx:20` is dead code; remove it rather than shipping the address.
- Hand-maintained `lib/supabase/database.types.ts` has drifted:
  - Missing tables: `workspaces`, `sync_operations`.
  - Missing columns: `workspace_id`, `revision`, and the `sync_*` columns on several tables.
  - Most RPCs are untyped.

  The sync code casts to `any` (`core-sync.ts:175`, `roster-import.ts:66`), so none of this is checked. Generate the types with `supabase gen types` in CI.
- Missing indexes on foreign keys (from the static audit):
  - `owner_id`, `updated_by` and the composite `(workspace_id, owner_id)` on most tables.
  - `attendance(workspace_id, student_id)`, `session_behaviors(workspace_id, student_id)`, and `lesson_plans` / `lesson_progress` / `memoranda_files` on `unit_id`.

  These matter little at single-teacher scale, but the advisors will flag them.
- `clear_roster_data` deletes **all** `sync_operations` for the workspace, not just the roster ones (`20260922090000_clear_roster_data.sql:27`).
- Nullable columns inside unique keys don't enforce uniqueness: `sessions.start_time`, `lesson_progress.unit_id` / `unit_key`, and `classes.academic_year` (never set by the import).
- Two permissive SELECT policies on avatars in `storage.objects` (redundant).

### 3.10 Process

- **No CI.** `.github/` holds only prompts. Add a workflow running lint, test, build and a type check on every PR.
- **Every deploy goes straight to Production.** 7 production deploys in about 24 h; no previews in `vercel ls`. Given the sync risk, deploy to Preview and test there before promoting.
- **Tests stop at `lib/`.** There are 56 unit tests but no component or E2E tests. The two Critical bugs above would each be caught by a short Playwright test (delete → reload; new account → the school field is empty).

---

## 4. Prioritised action list

| # | Priority | Action | Effort |
|---|---|---|---|
| 1 | Critical | Make remote state authoritative after load; remove the empty-roster guards; add a delete → reload test (§3.1) | 0.5–1 d |
| 2 | Critical | Blank out `DEFAULT_PROFILE` personal fields, footer and fallbacks; neutral placeholders; export warning (§3.2) | 2–3 h |
| 3 | High | New migration for roster import; fix/drop `upsert_grade`; verify live function definitions (§3.3) | 2 h |
| 4 | High | Composite FK plus workspace-ownership check in `claim_sync_operation`; revoke from anon/public (§3.4) | 2 h |
| 5 | Medium | `retrySync` false failure; retry button only on real failure; quieter toasts (§3.5) | 2 h |
| 6 | Medium | Grade range feedback; duplicate appreciation; input labels (§3.6) | 1–2 h |
| 7 | Medium | `aria-pressed` on toggles; label the modal close button; larger touch targets (§3.7) | 0.5 d |
| 8 | Medium | CI workflow; Preview-first deploys; Playwright smoke tests for §3.1 and §3.2 | 0.5–1 d |
| 9 | Low | Generate DB types; add FK indexes; realtime for tombstones; copy fixes (§3.8, §3.9) | 1 d |

After #1–#4, run the Supabase security and performance advisors via MCP. Then repeat this walkthrough on two devices, including the Excel/Moumtaze imports with real files.

---

## 5. Test data created during this review

All test data was created in the throwaway account used for this review, not in a real workspace:
- Class "3 ع ت 1"
- 3 students named "تلميذ تجريبي …"
- One session on 2026-09-23 with attendance
- One grade

I deleted the class, and the server confirmed it: `classes`, `students` and `attendance` are empty. Because of §3.1, that browser's IndexedDB cache may still show the class. Clear site data before reusing that account.
