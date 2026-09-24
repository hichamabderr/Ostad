# Sync, Durability & Data-Safety Review — Mueen Al-Ostad (معين الأستاذ)

**Date:** 2026-09-24
**Commit reviewed:** `9b7f408` (`arena/01a0d4fa-ostad`, branched from `main`)
**Scope:** the whole app, with a deep focus on the sync engine and on the specific
requirement: *"تأكد أن مزامنة البيانات تعمل بشكل جيد وأن التطبيق يحافظ على البيانات في حالة
الخروج أو حذف بيانات المتصفح، مزامنة البيانات إلى الخادم أمر مهم"*
(data must survive logout and "clear browser data"; cloud sync must be reliable).

**Method**

- Read every file that touches persistence: `hooks/useCloudAppState.ts`, `lib/state-cache.ts`,
  `lib/sync-outbox.ts`, `lib/supabase/*` (core-sync, roster-import, memoranda, avatar, auth),
  `lib/binary-storage.ts`, `lib/backup-archive.ts`, `lib/storage.ts`, `components/AuthGate.tsx`,
  `components/SettingsSanad.tsx`, the 19 SQL migrations and `app/sw.ts`.
- Traced every write path from each screen to IndexedDB → outbox → Postgres.
- Wrote and ran throw-away reproduction tests against the real modules (mocked Supabase client,
  real outbox/cache code) for the four scenarios that matter: remote-delete, stale cache,
  fresh browser, logout. Raw output in §7.
- Ran the repo's own quality gates: `npm run lint`, `npx vitest run`, `npm run build`, `npm ci`,
  `npm audit --omit=dev`.

**Limits — what I could not verify**

- No live Supabase credentials in this environment, so I could not replay a real two-device
  session, read production rows, or run the Supabase advisors. All findings below are from
  static analysis + unit-level reproduction, and each one names the file and lines.
- `npm run build` cannot complete in this sandbox because `next/font` fetches Amiri/Geist/Tajawal
  from Google Fonts at build time and this environment has no route to `fonts.googleapis.com`
  (unrelated to the code under review — see L7).
- No browser run, so realtime/`Cache Storage`/service-worker behaviour is reasoned from the
  code and from the libraries' documented behaviour, not observed live.

---

## 1. Verdict — the three questions that were asked

| # | Question | Answer today | Confidence |
|---|---|---|---|
| 1 | **Does cloud sync work?** | **Mostly yes, but it is not authoritative.** Every entity has a table + an outbox path; writes are delta-based, idempotent and retried with backoff. But the client *merges* server state with its own cache instead of accepting it, so the server is not the source of truth in practice (§3.1, §3.2). | High |
| 2 | **Does data survive logout?** | **Partly — and silently.** The workspace cache is deleted on sign-out without flushing or warning. Pending writes that are already in the outbox survive (verified, §7-F); anything not yet in the outbox is lost. Other users' artefacts (PDF blobs, memoranda outbox, avatar blob) are *not* cleaned, and the memoranda outbox is not owner-scoped, so it can be uploaded into the **next** account that signs in on that device (§3.3). | High |
| 3 | **Does data survive "clear browser data"?** | **Yes for the structured workspace** — with an empty IndexedDB cache, `loadCoreState` restores classes, students, grades, sessions, attendance, behaviours, timetable, lesson progress, plans, custom units, settings and profile from Postgres (verified, §7-C). **No for:** (a) writes still sitting in a JS timer/queue at the moment of the wipe, (b) locally cached PDF binaries (metadata comes back, the file must be re-fetched from Storage), (c) the local tombstone list. | High |
| 4 | **Is two-device / delete consistency safe?** | **No.** A record deleted on device A survives forever in device B's workspace (`retainLocal`, §3.1), and if the user then edits that "ghost" record the app **re-creates it in the database and deletes the deletion tombstone** — the delete is undone on the server (verified, §7-E). Realtime never delivers the delete either (§3.4). | High |

**Bottom line:** the sync *engine* is well designed for the single-device happy path, but the
system's contract ("Supabase is the source of truth") is not enforced by the client, and the
logout path is a one-tap, unconfirmed, unrecoverable-looking operation. Before this app is trusted
with a teacher's real year of marks, fix **§3.1–§3.3** and add the regression tests in §6.

---

### ملخص بالعربية (Arabic summary)

**هل المزامنة تعمل؟** نعم في المسار العادي للجهاز الواحد: كل كيان له جدول ومسار outbox واضح،
والكتابة تفاضلية مع إعادة محاولة، والاستعادة من السحابة بعد **حذف بيانات المتصفح تعمل فعلاً**
(مثبتة بالاختبار: العودة بحساب جديد على متصفح نظيف تعيد الأقسام والتلاميذ والنقاط والحصص
والحضور والتوقيت والمنهاج والإعدادات والملف المهني). لكن السحابة **ليست مصدر الحقيقة فعلياً**
لأن العميل يدمج النسخة السحابية مع الكاش المحلي.

**١. خطر حقيقي على سلامة البيانات (Critical):** القسم المحذوف على جهاز آخر يبقى ظاهراً عندك
للأبد (`retainLocal` في `lib/supabase/core-sync.ts:274`)، وإذا عدّلت ذلك "الشبح" فإن التطبيق
**يعيد إنشاء الصف في قاعدة البيانات ويمسح شاهد الحذف** — أي أن عملية الحذف تُلغى نهائياً
(مثبت بالاختبار: `UPSERT classes` ثم `DELETE sync_tombstones`). كذلك لا تصل أحداث الحذف للجهاز
الآخر عبر Realtime لعدم تفعيل `replica identity full`.

**٢. الخروج (Logout):** زر واحد بدون تأكيد يحذف النسخة المحلية كلها. العمليات الموجودة في
الـ outbox تنجو (مثبتة)، لكن أي تعديل لم يُسجَّل بعد يضيع. كما أن ملفات PDF المعلّقة في طابور
المذكرات غير مربوطة بمالك، فيمكن رفع ملف أستاذ سابق باسم حساب جديد على نفس المتصفح، ومفاتيح
ملفات PDF مشتركة بين كل المستخدمين.

**٣. الخدمة العمال (Service Worker):** يخزّن استجابات Supabase المصدَّقة (قاعدة `cross-origin`
في `defaultCache`)، وهذا يعني احتمال ظهور بيانات حساب سابق لحساب جديد عند تعثر الشبكة، مع بقاء
بيانات التلاميذ في Cache Storage.

**أسرع خمس خطوات إصلاح:** (١) اجعل السحابة مرجعاً وحيداً عند التحميل + اقرأ `sync_tombstones`،
(٢) اجعل شاهد الحذف يتغلّب على أي مراجعة محلية، (٣) تأكيد الخروج + تفريغ الطابور + مسح كل
البيانات المحلية للمستخدم، (٤) `replica identity full` والاشتراك في `sync_tombstones`،
(٥) `NetworkOnly` لكل طلبات Supabase في الـ service worker. وكل واحدة من هذه الخمس تحتاج
اختبار انحدار (القائمة الجاهزة في §6).

---

## 2. How the sync engine works today (map)

```
Screen (updateStateAndWait)                    Screen (updateState → UI-only fields)
        │ 1. state updated in memory                     │
        │ 2. await saveAppStateCache()  ──────────────►  IndexedDB  sanad:app-state:v4:<uid>
        │ 3. await enqueueSyncDelta()   ──────────────►  IndexedDB  sanad:sync-outbox:<owner>:<device>:<rev>:<ts>
        │ 4. flushSyncOutbox()                           │  (relies on the 300 ms debounce; skipped
        │      • flushAvatarOutbox(owner)                │   entirely while status = local-only/conflict)
        │      • flushMemorandaOutbox()                  │
        │      • for each entry: applySyncOutboxEntry → Postgres
        │            – reconcile by business key (name / number_in_list / …)
        │            – conflictIfStale(sync_revision vs local revision)
        │            – tombstone guard, then upsert/delete
        │            – claim_sync_operation(...)
        │      • remove entry only after acknowledgment
        ▼
   Supabase Postgres (19 tables, RLS by owner_id)  +  Storage buckets (memoranda, avatars)
        │
        └─► Realtime postgres_changes → refreshRemoteState() → full 14-table reload
```

**Entity coverage (verified complete for the listed fields):**

| AppState | Cloud | Restored after cache wipe | Notes |
|---|---|---|---|
| `profile` | `profiles` | ✅ | `avatar_url` only stores non-`data:` URLs; the file goes to Storage via the avatar outbox |
| `classes`, `students`, `grades`, `sessions`, `timetable`, `lessonProgress`, `customUnits`, `lessonPlans`, `dashboardTasks` | matching tables | ✅ | Long-tail fields round-trip as JSON in `teacher_notes` / `notes` / `metadata` / `content` |
| attendance + 4 behaviour flags (inside `sessions`) | `attendance`, `session_behaviors` | ✅ | independent relational tombstones exist |
| `calendarSettings`, `theme`, `dashboardStyle`, `sidebarCollapsed`, `onboardingDismissed`, `activeClassId`, `activeTrimester` | `app_settings.settings` (jsonb) | ✅ | |
| `unitPdfFiles` **metadata** | `memoranda_files` | ⚠️ metadata only | `fileStorageKey` is **not** restored, so the local binary is orphaned; viewing falls back to a 7-day signed URL |
| `unitPdfFiles` **binary** | Storage `memoranda` | ❌ locally | no download-and-cache step exists; offline access to a teacher-uploaded PDF is lost after a wipe |
| `deletedRecordIds` | `sync_tombstones` | n/a | tombstones pending locally are lost with the cache |
| `cloudRevision` | derived (`max(sync_revision)`) | ✅ | also drives the local revision clock |
| device id | `localStorage` | n/a | regenerated after a wipe — see §3.7 |

Outbox design points that are genuinely good and should be preserved: operation-level entries
(never whole snapshots), deterministic UUIDs (`getCloudRecordId`), business-key reconciliation to
avoid unique-constraint fights, `claim_sync_operation` idempotency ledger, capped exponential
backoff, and "never delete an outbox entry before acknowledgment".

---

## 3. Findings

### 3.1 CRITICAL — `retainLocal` keeps records the server has deleted (and can undo the delete)

**Where:** `lib/supabase/core-sync.ts:252` (`loadCoreState`), `:274–292` (`retainLocal`), used for
`class`, `student`, `grade`, `session`, `timetable`, `lessonProgress`, `customUnit`, `lessonPlan`,
`dashboardTask`.

```ts
const retainLocal = (entity, remoteItems, localItems) => {
  const retained = (localItems ?? []).filter(item =>
    !remoteIds.has(item.id) &&
    !remoteIds.has(getCloudRecordId(userId, entity, item.id)) &&
    !localState.deletedRecordIds?.includes(`${entity}:${item.id}`));   // ← only LOCAL tombstones count
  if (remoteItems.length > 0) return retained.length ? [...remoteItems, ...retained] : remoteItems;
  return isDemoState(localState) ? [] : retained;                      // ← remote empty ⇒ local wins
};
```

**Evidence (ran against the real module, §7-A/B):** remote `[]` + stale cache of 1 class/1 student
→ the loaded state still contains 1 class / 1 student. Remote keeps class A, cache still has class
B (deleted on another device) → the loaded state contains **A and B**.

**Impact**

- A class deleted on device A (or on the web after a cloud reset) is still shown on device B
  forever; the cache is then rewritten with the ghost, so it never disappears.
- Editing the ghost is enough to resurrect it on the server: `applyOperationOnce` clears the
  tombstone whenever `tombstone.revision < metadata.revision` (`core-sync.ts:632`) and then
  `delete`s it (`:643`). **Evidence (§7-E): saving an edit on a record that device A deleted emits
  `UPSERT classes: bbbb…` followed by `DELETE sync_tombstones`.** Because the local revision clock
  is a global counter that keeps growing, the tombstone guard silently stops protecting the delete.
  (An *unrelated* edit does not re-upload the ghost, because the merged state becomes the diff
  baseline — the danger is specifically touching the ghost, or writing while the baseline is `null`:
  §3.7.)
- The empty-remote branch also means a wiped/emptied server (reset done elsewhere, admin cleanup,
  brand-new account used on a device that still holds an old cache) is silently repopulated by the
  local cache on the next load, including data the teacher already deleted.

**Fix**

1. Make the server authoritative after a successful load: replace the merged list with the remote
   list, and only keep a local record when you can *prove* it is pending — i.e. an outbox entry
   (or a "created locally" marker) references its id.
2. In `loadCoreState`, fetch `sync_tombstones` for the workspace and drop any local record whose
   `(entity_type, entity_id)` has a tombstone — this is the server-side equivalent of
   `deletedRecordIds` and removes the need to trust the local cache.
3. Change the tombstone guard from `>=` to "a tombstone always wins unless it was written by this
   device" (or compare against a per-record version, not a global counter).
4. Regression tests: "remote empty + stale cache + empty outbox ⇒ 0 classes" and "upsert of a
   deleted record ⇒ rejected, tombstone preserved".

### 3.2 HIGH — the local cache is written but never *reconciled*; the client has two truths

**Where:** `hooks/useCloudAppState.ts:300` (initial load) and `:388–400` (`refreshRemoteState`),
`lib/state-cache.ts:101–113`.

`saveAppStateCache` still refuses to overwrite a "real" cache with demo data (fine), but nothing
replaces a stale cache with the authoritative remote snapshot except the very load path that
`retainLocal` defeats. There is also no user-visible "restore from cloud" action, so when the two
truths diverge the only recovery is a manual JSON/ZIP restore.

**Fix:** after a successful remote load, write the remote snapshot to the cache
unconditionally (plus the pending-outbox overlay), and add a **Settings → “إعادة المزامنة الكاملة
من السحابة”** action (with `ConfirmDialog`) that clears the cache/outbox for the current user and
reloads from the server. This is the missing escape hatch for any future divergence.

### 3.3 HIGH — logout: one unconfirmed tap wipes the local workspace; cross-account leaks stay behind

**Where:** `components/AuthGate.tsx:75–88` (`supabaseSignOut`), `components/SidebarSanad.tsx:321–331`
(button, no `ConfirmDialog`), `lib/state-cache.ts:61` (`clearAppStateCache`),
`lib/supabase/memoranda-storage.ts:106` (`flushMemorandaOutbox`), `lib/supabase/memoranda-outbox.ts`
(key `sanad:memoranda-outbox:*`, no owner), `lib/binary-storage.ts:41` (`sanad:pdf:<unitId>` — not
user-scoped).

```ts
async function supabaseSignOut() {
  const { data } = await supabase.auth.getUser();
  if (data?.user?.id) await clearAppStateCache(data.user.id);  // ← local mirror deleted
  const { error } = await supabase.auth.signOut();             // ← no flush, no warning
}
```

**Evidence (§7-F):** after the sign-out sequence, the workspace cache is `null` and 1 pending
outbox entry remains. So pending outbox writes do survive — but they survive *only* if they were
already enqueued; a change that is still inside the debounce/await window is gone with the cache.

**Impact**

1. **Silent data loss on logout while offline or while the cloud is unhappy.** Sign-out is allowed
   with `cloudStatus = sync-pending | sync-failed | local-only | conflict`, there is no warning and
   no confirmation, and the local mirror (the only other copy) is deleted in the same breath.
2. **Cross-account leak (privacy).** `flushMemorandaOutbox()` takes **no owner argument** and
   uploads whatever is in the outbox to `users/<current user>/…`. Precondition: teacher A's upload
   was queued (offline, or the upload failed) and A signs out before the flush. Then teacher B signs
   in on the same browser and **A's PDF is uploaded into B's workspace** and inserted into
   `memoranda_files` with `owner_id = B`. (`flushAvatarOutbox(userId)` does verify the session — the
   memoranda path should copy that pattern.)
3. **Shared-device leakage of binaries.** `sanad:pdf:<unitId>` is keyed by the *curriculum* unit id,
   which is identical for every teacher. Precondition: A's session ends without the sign-out handler
   running (expired session, closed browser), so A's cache survives; then B uploads a PDF for the
   same unit and overwrites the blob at the same key. When A signs back in, A's cached
   `unitPdfFiles[unitId].fileStorageKey` still points at that key and renders **B's file**. Making
   the keys user-scoped removes the class of bug entirely.
4. Sign-out also leaves A's avatar outbox blob in IndexedDB (harmless-ish, but it should be cleaned).

**Fix**

1. Make sign-out a two-step, honest operation: if status ≠ `ready` or the outbox is non-empty, show
   `<ConfirmDialog>` — "لديك N تغييرات لم تُزامن بعد. مزامنتها الآن / تصدير نسخة احتياطية / الخروج بأي حال".
2. Before clearing the cache: `await flushSyncOutbox(..., force: true)` with a short timeout, then
   clear **all** user-scoped local data: the state cache, `sanad:pdf:*` (or user-scoped keys),
   the avatar binary, the memoranda outbox entries **for that owner**, and the avatar outbox.
3. Namespace every local key by owner id: `sanad:pdf:<uid>:<unitId>`, `sanad:memoranda-outbox:<uid>:*`.
4. Add `ownerId` to `MemorandaOutboxOperation` and verify it inside `flushMemorandaOutbox`, exactly
   like `flushAvatarOutbox`.

### 3.4 HIGH — deletes never reach other devices in realtime

**Where:** `hooks/useCloudAppState.ts:403–426` (subscription list), `supabase/migrations/*`
(no `replica identity full` anywhere), `20260923203000_audit_fixes_and_ledger.sql:332` (adds
`sync_tombstones` to the publication, but the client never subscribes to it).

- The channel subscribes with `filter: owner_id=eq.<uid>` for every table except `profiles`.
  Supabase documents that *“you can only filter Delete events … if the table has the replica
  identity set to full”* — no migration sets it, so **DELETE events are effectively never delivered**
  to these filtered subscriptions.
- `sync_tombstones` is now in the publication but is not in `synchronizedTables`, and
  `loadCoreState` never reads tombstones, so other devices cannot learn about a deletion at all.
- Combined with §3.1 this is the "delete on the phone, the laptop keeps it" bug — and the laptop
  can re-upload the deleted data.

**Fix:** add `alter table … replica identity full` for the synced tables (or drop the `owner_id`
filter and filter client-side), subscribe to `sync_tombstones`, and apply tombstones in
`loadCoreState` (§3.1 fix #2).

### 3.5 MEDIUM — a realtime refresh can silently discard a just-made local edit

**Where:** `hooks/useCloudAppState.ts:388–400`. The concurrency guard runs *before* the `await`;
nothing re-checks after it, and the result replaces the whole state:

```ts
if (syncingRef.current || pendingSaveTimerRef.current !== null || outbox.length > 0) return; // ← before await
const remoteState = await loadCoreState(client, latestStateRef.current);                    // ← network
latestStateRef.current = remoteState; lastSyncedStateRef.current = remoteState;
setState(remoteState);                                                                      // ← clobbers an edit made meanwhile
```

Impact depends on how the edit was written:

- **Permanent loss** for fields written through `updateState` (the 300 ms debounce path): the save
  effect re-runs, sees `state === lastSyncedStateRef.current` (`:448`) and returns early, so the
  edit is never enqueued — and the 400 ms cache write then persists the clobbered state. Today that
  path carries `activeClassId` and `onboardingDismissed` (`AttendanceSanad`, `ClassesManager`,
  `Dashboard`, `GlobalSearchModal`, `GradesAndEvaluation`), i.e. the user's "current class" can
  silently roll back; it becomes a data bug the moment a screen starts using `updateState` for
  business data again.
- **Transient revert** for `updateStateAndWait` writers: the write still reaches the outbox (the
  closure captures the new state), so the server ends up correct, but the UI/cache show the older
  remote state until the next reload.

Because DELETE events bypass the echo-cancellation check (`payload.new.sync_device_id` is empty on
delete), **the app's own deletes can trigger this refresh on a single device** too.

**Fix:** capture a generation/sequence number before the await and drop the result if the state
changed meanwhile (the hook already has `saveGenerationRef` — use it here), or merge instead of
replacing when `latestStateRef.current !== baseline`.

### 3.6 MEDIUM — no flush on `pagehide`/`visibilitychange`; the outbox lives in timers

**Where:** `hooks/useCloudAppState.ts:344–359` (cache save, 400 ms debounce) and `:455` (outbox
enqueue, 300 ms debounce). The only unload hook in the whole app is
`components/GradesAndEvaluation.tsx:556–568` (grades draft). Business-data writes go through
`updateStateAndWait`, which awaits two IndexedDB writes (`saveAppStateCache` → `enqueueSyncDelta`)
before the flush, so a tab closed or killed inside that window loses the change; UI/state fields
written through the 300 ms debounce path (`activeClassId`, `onboardingDismissed`) lose it after a
tab close or a browser kill as well. Mobile browsers (iOS/Android) routinely kill backgrounded
tabs without any unload event, which is exactly the situation this app is designed for.

**Fix:** add a single `pagehide`/`visibilitychange` handler that (a) cancels the debounces, (b)
writes the cache and outbox synchronously, and (c) attempts a `flushSyncOutbox` (the outbox entry
is enough — it will be flushed on the next start, which the code already does at boot).

### 3.7 MEDIUM — the local revision clock can start at 0 → conflict storms and full-state uploads

**Where:** `hooks/useCloudAppState.ts:689` (`await enqueueSyncDelta(user.id, lastSyncedStateRef.current, …)`),
`lib/sync-outbox.ts:143–149` (`getSyncOperationsDelta` → `getSyncOperationsForState` when the baseline is `null`),
`core-sync.ts:442–455` (`conflictIfStale`).

If the initial cloud load fails (offline start, schema hiccup → `local-only`), `lastSyncedStateRef`
stays `null` and `revisionRef` stays `0`. Then:
`getSyncOperationsDelta(null, state)` falls back to `getSyncOperationsForState(state)` — i.e. a
**full-workspace upload** on the first keystroke — and the operation carries `revision = 1`, while
existing rows carry `sync_revision` in the tens/hundreds, so every row triggers
`SyncConflictError` → the conflict dialog repeats per record.

**Fix:** persist the last known revision with the cache; when a flush runs in a state where the
load never succeeded, first read `max(sync_revision)` (a single cheap query) and set
`revisionRef` to it; treat "same device id" (or "same owner + no concurrent writer") as
last-write-wins instead of raising a conflict.

### 3.8 MEDIUM — the service worker caches authenticated API responses (cross-account replay)

**Where:** `app/sw.ts:1,18` (`runtimeCaching: defaultCache` from `@serwist/next`),
`app/page.tsx:170–185` (registration).

Serwist's production `defaultCache` ends with a catch-all rule:

```js
{ matcher: ({ sameOrigin }) => !sameOrigin,
  handler: new NetworkFirst({ cacheName: "cross-origin", maxAgeSeconds: 3600, networkTimeoutSeconds: 10 }) }
```

That matches every cross-origin GET, including `https://<project>.supabase.co/rest/v1/…` **with the
user's `Authorization` header**, and falls back to the cached body when the network is slow (>10 s)
or unavailable. Cache Storage is per-origin, not per-user: after a logout/login on the same browser,
a network hiccup can replay the previous account's roster into the new account's workspace, and
student data is persisted in a cache that "clear cookies" does not remove.

**Fix:** add an explicit `NetworkOnly` matcher for `new URL(url).hostname.endsWith('.supabase.co')`
(and for `!sameOrigin` in general) before the default rules, and/or configure `runtimeCaching`
explicitly instead of `defaultCache`. Keep only first-party app shell/assets cached.

### 3.9 MEDIUM — sync status can stick on "قيد المزامنة"

**Where:** `hooks/useCloudAppState.ts:146` (`if (!client || syncingRef.current) return false;`),
call sites at `:472–486` and `:553–566`.

When a flush is already running, a second caller gets `false` and returns without scheduling a
retry, so the status can stay at `sync-pending` ("جارٍ حفظ التغييرات…") until the next edit, the
next `online` event, or an explicit retry — even though every write was acknowledged. The
background flush that completes does not set `ready` either (only the caller that awaited it does),
and `retrySync`/`retryWhenOnline` silently return while a flush is in flight.

**Fix:** have `flushSyncOutbox` return a reason/`Promise` that callers can await (single-flight
queue), and let the flush itself own the terminal status transition (`ready` / `sync-failed`).

### 3.10 MEDIUM — egress and latency: full reloads, `getUser()` per flush, whole-DB key scans

- `hasAuthenticatedOwner` (`useCloudAppState.ts:118–127`) calls `client.auth.getUser()` — a network
  round-trip to `/auth/v1/user` — on **every** flush, i.e. potentially on every attendance tap.
- `refreshRemoteState` re-reads **14 tables + memoranda** on every realtime event
  (`core-sync.ts:252–259`, `select('*')`, no `updated_at > since` filter).
- `listSyncOutbox` does `keys()` over the entire IndexedDB database (including the PDF blobs) and
  then `get()`s every key, on each flush loop iteration.
- `flushSyncOutbox` also flushes the avatar and memoranda outboxes on every call.

**Fix:** cache the auth check for ~30 s (or use `getSession()` + an owner check), drive realtime
refreshes from the payload/revision instead of a full reload, keep an explicit outbox index key
(`sanad:sync-outbox-index:<owner>`), and only run the avatar/memoranda flushes when they are known
to be non-empty (a cheap counter key).

### 3.11 LOW / hygiene

| # | Item | Where |
|---|---|---|
| L1 | **CI is red today:** `npm ci` fails with `EUSAGE … Missing: @emnapi/runtime@1.11.3, @emnapi/core@1.11.3 from lock file` — `package.json` and `package-lock.json` are out of sync, and `.github/workflows/ci.yml` starts with `npm ci`. | `package-lock.json`, `.github/workflows/ci.yml` |
| L2 | Migrations `20260921071000_atomic_roster_import.sql` and `20260922080000_resilient_roster_import.sql` are **byte-identical** (md5 `13fbe33d…`) — the "edit an applied migration" smell is still in the tree; the authoritative version now lives in `20260923203000_audit_fixes_and_ledger.sql`. Keep one and delete the twin. | `supabase/migrations/` |
| L3 | `lib/supabase/database.types.ts` is still hand-maintained (`SimpleTable<{…}>` for `workspaces`, `sync_operations`, `sync_tombstones`), so column drift is not caught by `tsc`, and the sync code compensates with 16 `as any` casts. | `lib/supabase/database.types.ts`, `core-sync.ts:175`, `roster-import.ts:66` |
| L4 | Dead code: `migrateLocalCoreData()` (never called; it also inserts rows without `workspace_id`), the `lib/dashboard-tasks.ts` IndexedDB store (only `clearDashboardTasks` is used), `updatedAtRef` in the hook, `firstAppState`-era helpers. | as listed |
| L5 | Docs contradict the code: the tail of `STATE-INVENTORY.md` claims *"Zero-Resurrection"*, *"Zero-Data-Loss … after logout"*, *"Zero-Loss Cloud Sync"* and *"PHANTOM DELETE elimination"*. §7-A/B/E show resurrection and post-delete re-creation still happen. Keep the changelog but mark each claim with the test that proves it. | `STATE-INVENTORY.md` |
| L6 | Settings copy still sells the old model: *"تطبيق «معين» يعمل بنمط Offline-First ويخزن بياناتك محلياً في متصفحك… يمكنك تنزيل نسخة احتياطية لنقلها لجهاز آخر"* — with Supabase as the source of truth this should say data is stored in the account and can be restored on any device, backup being for extra safety. | `components/SettingsSanad.tsx:740–747` |
| L7 | `next.config.ts` ships `allowedDevOrigins: ['192.168.1.25']` (one developer's LAN IP) and `next/font/google` requires network access at build time → non-hermetic CI builds. Vendor the fonts (`next/font/local`). | `next.config.ts`, `app/layout.tsx` |
| L8 | `npm audit --omit=dev`: 5 advisories (3 high) — `xlsx@0.18.5` prototype-pollution + ReDoS (**no fix on npm**; SheetJS publishes ≥0.20.3 outside npm), `@serwist/next→browserslist`, `express→qs`. `xlsx` parses files that teachers receive from school administration, so treat it as a real (if low-probability) input-validation surface, or parse in a worker with a file-size/time cap. | `package.json`, `npm audit` |
| L9 | Every `keys()`-based cleanup (`listBinaryKeys`, `listSyncOutbox`, `listMemorandaOutbox`, `cleanupStaleStorage`) scans the whole database, and `defaultCache`'s same-origin "others" rule will happily store the 10 MB memoranda PDFs in Cache Storage. Scope the rules. | `lib/binary-storage.ts`, `lib/sync-outbox.ts`, `app/sw.ts` |
| L10 | Minor state gaps: a signed (7-day) avatar URL can be written back into `profiles.avatar_url` when the user re-saves the profile; `restorePdfBackupArchive` restores `fileStorageKey` values that are not user-scoped (§3.3-3). | `core-sync.ts:487`, `lib/backup-archive.ts` |

---

## 3bis. Implementation status — Phase 1 (2026-09-24)

Implemented on `arena/01a0d4fa-ostad` (commit below), with regression coverage in
`__tests__/data-safety.test.ts` (18 tests):

| § | Item | Status | Where |
|---|---|---|---|
| 3.1 | Remote is authoritative on load; local records survive only with pending outbox work | ✅ done | `core-sync.ts` (`retainLocal`, `pendingRecordIds`) |
| 3.1 | Server tombstones are read and drop stale cache entries | ✅ done | `core-sync.ts` (`sync_tombstones` read) |
| 3.1 | Tombstone beats a newer local revision; override only by explicit user decision | ✅ done | `core-sync.ts` (`tombstoneFromOtherDevice`), `sync-outbox.ts` (`allowTombstoneOverride`) |
| 3.1 | An existing delete is never re-labelled as this device's | ✅ done | `core-sync.ts` (delete op preserves `device_id`) |
| 3.2 | Settings → “إعادة المزامنة الكاملة من السحابة” escape hatch (with confirm) | ✅ done | `useCloudAppState.resyncFromCloud`, `SettingsSanad.tsx` |
| 3.3 | Sign-out: pending-work dialog, flush, then full owner-scoped purge | ✅ done | `SignOutDialog.tsx`, `app/page.tsx`, `lib/local-user-data.ts` |
| 3.3 | Memoranda outbox owner-scoped and verified against the session | ✅ done | `memoranda-outbox.ts`, `memoranda-storage.ts` |
| 3.3 | PDF binaries owner-scoped (`sanad:pdf:<ownerId>:<unitId>`) + legacy migration | ✅ done | `binary-storage.ts`, `LessonPreparation.tsx`, `backup-archive.ts` |
| 3.6/3.10 | Offline (`local-only`) edits are queued and retried instead of living in memory | ✅ done | `useCloudAppState.ts` (debounced save effect) |
| — | Local memoranda metadata no longer erases `fileStorageKey` | ✅ done | `core-sync.ts` (unitPdfFiles merge) |
| — | CI: `npm ci` lock file back in sync | ✅ done | `package-lock.json` |
| 3.4 | Realtime deletes: `replica identity full` on every published table + `sync_tombstones` subscribed | ✅ Phase 2 | `supabase/migrations/20260924120000_realtime_delete_propagation.sql`, `lib/realtime-guard.ts` |
| 3.5 | Realtime clobber race: a fetch started before a local edit can no longer overwrite it | ✅ Phase 2 | `hooks/useCloudAppState.ts`, `lib/realtime-guard.ts` (`shouldApplyRemoteRefresh`) |
| 3.5 | Own writes no longer trigger a refresh echo (including tombstone INSERT/DELETE payloads) | ✅ Phase 2 | `lib/realtime-guard.ts` (`isSelfAuthoredChange`) |
| 3.6 | `pagehide`/`visibilitychange` persist the debounced delta and attempt one flush | ✅ Phase 2 | `hooks/useCloudAppState.ts` |
| 3.7 | Revision clock bootstrapped from the last known cloud revision (never goes backwards) | ✅ Phase 2 | `lib/realtime-guard.ts` (`nextRevisionFloor`) |
| 3.8 | Service worker `NetworkOnly` for Supabase and `/auth/` (was NetworkFirst + 1h cache) | ✅ Phase 2 | `app/sw.ts` |

### Phase 2 detail

**3.4 — Why deletes were invisible.** Realtime evaluates the subscription `filter` against the
record it is about to broadcast. Without `replica identity full`, the old record of a DELETE
carries only the primary key, so `owner_id=eq.<uid>` can never match and the client is simply
never told. `20260924120000_realtime_delete_propagation.sql` sets `replica identity full` on
every published table and keeps `sync_tombstones` on `supabase_realtime`, so a delete on one
device now reaches every open tab immediately instead of at its next cold load.

*Caveat, documented in the migration:* Postgres RLS is not evaluated for DELETE events (the row
no longer exists to be checked), so the subscription filter is what scopes the stream. Filters
are applied server-side before broadcasting, and every affected row carries `owner_id`.

**3.5 — The clobber race.** `refreshRemoteState` used to check its guards *before* the network
round trip and then apply the response unconditionally. An edit made during that window was
overwritten on screen by the older server copy — and only recovered if the debounced save
happened to flush afterwards. The hook now keeps a synchronous `localEditSeqRef` (bumped in
`updateState` and `updateStateAndWait`), captures it before fetching, and re-runs the whole
guard set after the response arrives via `shouldApplyRemoteRefresh`. The same helper also stops
a refresh from racing an outbox flush that owns the final state.

**3.6 — Tab close.** The debounced save holds up to 300ms of work in memory only, so a tab that
died inside that window lost the edit. On `pagehide`/`visibilitychange:hidden` the pending
delta is written to the outbox first (IndexedDB survives the unload) and a single best-effort
flush is attempted; anything that does not make it out is retried on the next start.

**3.7 — Revision clock.** `conflictIfStale` only rejects a write when the server revision is
strictly greater than the one sent, so a clock that restarts at 0 after a failed load silently
overwrites rows that changed meanwhile. The clock is now seeded from the cached
`cloudRevision` and only ever moves forward.

**3.8 — Service worker.** `defaultCache` routes every cross-origin GET through `NetworkFirst`
with a one-hour expiration, and the Supabase REST API lives on a cross-origin host: a
`classes`/`students`/`sync_tombstones` read could be replayed from the HTTP cache for an hour
after the server had already deleted the row. Supabase URLs (and one-time `/auth/` callbacks)
are now `NetworkOnly`, registered ahead of `defaultCache` because the first matching route
wins.

Gate results after Phase 1: `npx tsc --noEmit` clean, `npm run lint` clean,
`npx vitest run` **80/80 passed** (6 files). `npm run build` still needs network access for
`next/font` in this sandbox (L7); `npm ci` now resolves.

---

## 4. Fix list (priority order)

| # | Priority | Action | Files | Effort |
|---|---|---|---|---|
| 1 | **Critical** | Make the remote authoritative on load; keep local records only when an outbox entry proves they are pending; read `sync_tombstones` and drop tombstoned locals | `core-sync.ts`, `useCloudAppState.ts` | 1 d |
| 2 | **Critical** | Tombstone wins over a newer local revision (or per-record versioning) so an edit cannot re-create a deleted row | `core-sync.ts` | 3 h |
| 3 | **Critical** | Logout: confirm when unsynced, force-flush first, then purge all user-scoped local data; owner-scope the memoranda outbox + PDF binary keys | `AuthGate.tsx`, `SidebarSanad.tsx`, `memoranda-*.ts`, `binary-storage.ts` | 0.5 d |
| 4 | **High** | Realtime: `replica identity full`, subscribe to `sync_tombstones`, or refresh on visibility change | migrations, `useCloudAppState.ts` | 3 h |
| 5 | **High** | Fix the realtime clobber race (generation check after the await) | `useCloudAppState.ts:388-400` | 2 h |
| 6 | **Medium** | `pagehide`/`visibilitychange` flush; single-flight flush that owns the terminal status | `useCloudAppState.ts` | 3 h |
| 7 | **Medium** | Revision-clock bootstrap after a failed load; persist revision with the cache; last-write-wins for the same device | `useCloudAppState.ts`, `state-cache.ts` | 3 h |
| 8 | **Medium** | Service worker: `NetworkOnly` for cross-origin/Supabase traffic | `app/sw.ts`, `next.config.ts` | 1 h |
| 9 | **Medium** | Egress: cache the auth check, incremental loads, outbox index key | `useCloudAppState.ts`, `core-sync.ts`, `sync-outbox.ts` | 0.5 d |
| 10 | **Medium** | Regression + E2E tests for the 6 scenarios in §6; wire `npm ci` back to green | `__tests__`, `e2e/`, lockfile, CI | 1 d |
| 11 | **Low** | Hygiene: single roster-import migration, generated DB types, dead code, fonts, docs/copy truthfulness, `xlsx` | multiple | 1 d |

---

## 5. What should be *improved* (beyond bug fixing)

**Architecture / data model**

1. **One truth, one direction.** Write down the contract: *Postgres is authoritative; IndexedDB is
   simply a cache plus a queue of unsynced operations.* Enforce it in one function
   (`reconcile(remote, cache, outbox)`) and use it everywhere (load, realtime, retry, restore)
   instead of merging ad-hoc per entity.
2. **Give rows a real version.** A global per-device counter compared with `sync_revision` is fragile:
   it breaks after cache wipes, after device-id regeneration, and it makes "offline edit vs newer
   remote edit" look like a conflict even when the user simply worked offline. Prefer
   `updated_at` + `device_id` (last-write-wins per field/record) or a server-issued per-row version,
   and keep `sync_conflicts` for *true* concurrent edits only.
3. **Make the queue observable.** A `pendingOperations` count + `lastSyncedAt` + `lastError` exposed
   in the header and in a new **Settings → Sync** panel with: last successful sync, pending count,
   device id, "retry now", "full re-sync from cloud (destructive)", "export backup". Right now the
   user's only signal is a coloured pill.
4. **Boot-time recovery UX.** After login, show *"جارٍ استعادة مساحة العمل من السحابة…"* with counts
   (`N أقسام، M تلاميذ`). If the cloud is empty for a fresh account, say so explicitly — this is what
   removes the "did I lose everything?" fear after a device change or a cache wipe.
5. **Multi-device by default.** The teacher's phone and laptop are the normal case; treat
   "another device wrote" as an expected event everywhere (realtime, tombstones, conflict copy),
   not as an error path.

**Durability**

6. **Never keep the only copy in a timer.** `pagehide` flush + `Background Sync` (where supported)
   for the outbox; treat the outbox as durable storage, not as a network helper.
7. **Preserve offline PDFs with intent.** Add an explicit "تحميل نسخة للعمل دون إنترنت" action that
   pulls Storage → IndexedDB per user, and surface which units have no offline copy. Today the user
   cannot tell whether the memorandum will open in a class without signal.
8. **Backup nudge.** Automatic weekly reminder to export JSON+ZIP (or auto-save the last 3 backups to
   the device) — the JSON/ZIP tools already exist and are good; they are just never mentioned again
   after onboarding.
9. **Retention/restore.** Supabase point-in-time recovery plus an app-level "restore from cloud
   snapshot" would make destructive actions (`reset_workspace`, `clear_roster_data`, imports)
   reversible. Currently they are one-way.

**Security & privacy**

10. **Sign-out must be a purge.** All user data (cache, blobs, outboxes, SW caches) should be removed
    on sign-out on shared devices, with an opt-in "keep local copy on this device" for personal phones.
11. **Never cache authenticated API responses** (SW rule) and never share binary keys across users.
12. **Front-end input hardening for `xlsx`** (size/time caps, worker isolation) and revisit the
    "no fix available on npm" advisory.
13. **Server-side**: run the Supabase security/performance advisors in CI; keep RLS initplan-friendly
    style; consider a `sync_health` view (per table: row count, max revision, tombstone count) to
    diagnose divergence without touching the client.

**Process**

14. **Prove the claim before writing it in `STATE-INVENTORY.md`.** Every "zero-loss"/"zero-resurrection"
    bullet should name the test that fails if the behaviour regresses.
15. **E2E with two browser contexts** (Playwright) is the only way to keep this class of bug out:
    device A and device B share one test user. Add it to CI together with `lint`, `test`, `build`,
    and a `supabase db lint`/migration check.
16. **Preview-first deploys** and a tagged rollback for schema-affecting PRs.

---

## 6. Acceptance test matrix — "data is safe" contract

Run each row before claiming the requirement is met. `A`/`B` = two browser contexts signed into the
same account.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Delete + reload | Delete the last class → reload | 0 classes, 0 students, cloud has 0 rows (regression §3.1) |
| 2 | Delete on A, open B | A deletes a class; B (already open) and B after reload | Class disappears in B without a manual refresh; no re-upload |
| 3 | Edit a ghost | A deletes; B edits that record (still cached) | Write rejected / merged, tombstone preserved, no row re-created |
| 4 | Offline edits | B offline: attendance + grades + new class; reconnect | All changes reach the cloud; no conflicts for ordinary offline work |
| 5 | Logout with pending work | B offline edits → sign out → sign in | Warning shown before sign-out; nothing lost after re-login |
| 6 | Clear site data | Clear all site data → sign in | Full workspace restored from the cloud (classes, students, grades, sessions, attendance, timetable, progress, plans, settings, profile); PDFs viewable via signed URL; the app explains what was restored |
| 7 | Account switch on one device | A signs out, B signs in (with A's memoranda outbox non-empty) | Nothing of A's is uploaded into B; A's blobs are gone from IndexedDB |
| 8 | Tab close | Type a grade → close the tab within 300 ms → reopen | The value is present |
| 9 | Offline cold start | Open the app with no network | The last workspace appears (from cache) with an explicit "offline" state, no empty-workspace panic |
| 10 | Fresh account | New sign-in | Empty workspace, no demo data, no other account's data (verify in Network tab that nothing of the previous user is served) |

---

## 7. Appendix A — reproduction harness and raw evidence

Throw-away Vitest files (removed after the run; the repo is left clean). They import the real
`loadCoreState`, `applySyncOutboxEntry`, `state-cache` and `sync-outbox` and mock only
`idb-keyval` and the Supabase client.

```ts
// A/B) stale cache vs. server (lib/supabase/core-sync.ts:252-292)
const loaded = await loadCoreState(clientWithRemote({}), staleCache);
// A) remote=[] , cache=1 class ->  result classes: 1 students: 1        ← resurrection

const loaded = await loadCoreState(remoteKeepsClassA, staleCacheWithAandB);
// B) result classes: [ 'قسم أ', 'قسم ب' ]                              ← B was deleted remotely

// C) fresh browser (empty cache) — the recovery path after "clear site data"
const loaded = await loadCoreState(remoteWithOneClassAndStudent, getEmptyState());
// C) restore from cloud -> classes: 1 students: 1 activeClassId: aaaa… cloudRevision: 7

// E) saving an edit on a record deleted by another device (tombstone revision 5, local revision 9)
await applySyncOutboxEntry(client, ownerId, entryWithUpsertOfDeletedClass, 'device-B');
// E) SQL issued: [ 'UPSERT classes: bbbb…', 'DELETE sync_tombstones' ]  ← the delete is undone

// F) logout (AuthGate.supabaseSignOut order: clearAppStateCache(userId) → signOut())
// F) cache after sign-out: null
// F) pending outbox entries after sign-out: 1
```

Interpretation: **A** and **B** are §3.1 (server no longer authoritative), **E** is the tombstone
hole that makes the resurrection permanent, **C** is the good news for the "clear browser data"
requirement, **F** is the logout contract (outbox survives, cache does not).

## 8. Appendix B — tooling results on this commit

| Command | Result |
|---|---|
| `npm run lint` | ✅ clean (0 errors / 0 warnings) |
| `npx vitest run` | ✅ 62 passed / 5 files (`sync`, `storage`, `date-utils`, `grade-calculator`, `moumtaze-sync`) |
| `npm run build` | ❌ in this sandbox only: `next/font` cannot fetch Amiri/Geist/Tajawal (`fonts.googleapis.com` unreachable) → non-hermetic builds (L7) |
| `npm ci` | ❌ `EUSAGE`: lock file out of sync (`@emnapi/runtime@1.11.3`, `@emnapi/core@1.11.3` missing) → **CI is red** (L1) |
| `npm audit --omit=dev` | ⚠️ 5 advisories (3 high): `xlsx` (no npm fix), `@serwist/next→browserslist`, `express→qs` (L8) |

## 9. Appendix C — what is *good* and should be kept

- Route-per-workspace architecture, RTL native layout, and complete loading/empty/error states.
- The outbox concept: operation-level deltas, deterministic UUIDs, business-key reconciliation,
  an idempotency ledger (`sync_operations` / `claim_sync_operation`), capped backoff, tombstones,
  and "never delete before acknowledgment".
- Relational schema quality: composite FKs `(workspace_id, owner_id)`, `unique (workspace_id, id)`
  targets, RLS everywhere, `(select auth.uid())` policies, restore-safe `reset_workspace`, and the
  audit-fix migration that closed the earlier review's DB findings.
- Backup tooling: JSON export/import + checksummed PDF ZIP archive.
- The tests that do exist are meaningful (delta computation, tombstones, cache isolation, conflict
  guards) — they just do not cover the hook's lifecycle or two-device behaviour yet.
- `STATE-INVENTORY.md` as a practice is excellent; it only needs to stay true to the code.
