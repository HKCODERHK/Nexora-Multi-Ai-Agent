# Testing Nexora's backend

One test runner (Vitest) covers the whole backend. Every test sits next to the file it tests,
and no test talks to a real service: no Redis, no MongoDB server, no Firebase, no LLM, no Qdrant,
no internet.

## Run the tests

```bash
cd backend
npm ci                                  # vitest, supertest, mongodb-memory-server
npm ci --prefix gateway                 # each service's own node_modules must exist,
npm ci --prefix services/agent          # because the tests import the real service code
npm ci --prefix services/auth
npm test                                # = vitest run
```

Watch mode while coding: `npx vitest`. One file: `npx vitest run services/agent/graph/router.test.js`.

The first run of the credits test downloads a MongoDB binary for `mongodb-memory-server` (once,
then it is cached in `~/.cache/mongodb-binaries`). No database server, password or `.env` is needed.

## What each test file protects

| Test file | What it protects |
|---|---|
| `gateway/middleware/auth.middleware.test.js` | No session cookie or an expired session → 401; a valid session sets `req.user`. |
| `gateway/internalRoutes.test.js` | `/api/auth/update-plan` and `/api/auth/deduct-credits` return 404 from outside, including tricks like `UPDATE-PLAN`, `update-plan/` or `update%2Dplan`. |
| `gateway/utils/proxyWithHeader.test.js` | The gateway adds the internal key and the real user id, and drops a fake `x-user-id` sent by a browser. |
| `shared/security/internalKey.test.js` | Services refuse requests without the right `x-internal-key`; a missing key on the server is refused loudly, never silently allowed. |
| `services/agent/graph/router.test.js` | The router picks the right agent, and junk from the LLM (`"banana"`) can only ever become `chat`. |
| `services/agent/config/agentLimit.test.js` | Rate limit: 5 coding calls per user per minute, the 6th gets 429; users don't share counters. |
| `services/auth/controllers/deductCredits.test.js` | Credits are charged correctly and can never go below zero, even with many requests at the same moment. |
| `services/agent/utils/errorHandler.test.js` | Unknown errors return a clean 500 instead of crashing the error handler. |
| `services/agent/config/multer.test.js` | Uploaded files get a real timestamp in their name. |

## Fakes and mocks (and why tests never hit real services)

- A **fake** is a small, working replacement. `test-utils/fakeRedis.js` is a fake Redis: a
  JavaScript `Map` with `incr`, `expire`, `ttl`, `get`, `set`. It behaves like Redis for what we use,
  but lives in memory, so a test starts empty and finishes in milliseconds.
- A **mock** is a stand-in that returns what the test tells it to and records how it was called.
  The router test mocks the LLM (`getModel` returns an object whose `invoke` answers `" Coding\n"`),
  and the credits test mocks Firebase (`config/firebase.js`, `firebase-admin/auth`) because the
  `serviceAccountKey.json` it needs is a secret and is not in git.
- `mongodb-memory-server` starts a throw-away MongoDB inside the test process, so the credits test
  runs real MongoDB queries (which is the point: the race condition lives inside the database).

Why not use the real services? Real services make tests **slow** (network), **flaky** (a service
is down, a rate limit is hit), **costly** (every LLM call uses quota), **unsafe** (they need secrets,
and CI must never hold production keys) and **unrepeatable** (shared data changes between runs).
A test should fail only when our code is wrong.

## The two credit race conditions, and the fix

The old `deductCredits` did three separate steps:

```js
const user = await User.findById(userId)    // 1. read      (credits = 10)
if (user.credits < cost) return 400          // 2. check     (10 >= 10, ok)
user.credits -= cost; await user.save()      // 3. write     (credits = 0)
```

1. **Double spend.** Two coding requests (cost 10) arrive together for a user with 10 credits.
   Both read 10, both pass the check, both save `credits = 0`. The user got two answers for the
   price of one. Mix agents (coding + chat) and the balance is simply whichever save landed last.
2. **Lost update.** A payment adds 500 credits (`user.credits += 500; save()`) while a deduction
   runs. Each one saves the number it calculated from its own old read, so one change is overwritten.

The fix is to let MongoDB do the check and the change as **one atomic operation**:

```js
User.findOneAndUpdate(
  { _id: userId, credits: { $gte: cost } },   // only matches if there is enough
  { $inc: { credits: -cost } },               // subtract inside the database
  { returnDocument: "after" }                 // (the current name for { new: true })
)
```

MongoDB applies updates to one document one at a time. The second request no longer matches
`credits >= 10` (the balance is already 0), so it gets `null` → "Not enough credits.". `$inc` also
fixes the lost update, because it adds to whatever the value is *now*, not to an old copy.
The test fires 20 parallel requests at 35 credits and checks exactly 3 succeed and 5 credits remain.

## How the pipeline works now

`.github/workflows/deploy.yml`:

```
push to main ──► test ──► deploy-backend ──────────────────────────► deploy-frontend
                  │        build 5 Docker images (gateway, auth,       npm run build
                  │        chat, agent, billing) → push to Amazon      → sync to S3
                  │        ECR → ECS force-new-deployment               → CloudFront invalidation
                  │
pull request ───► test     (deploy jobs show as "skipped")
```

- `test` runs on Node 20 with **no secrets**: `npm ci` in `backend`, `gateway`, `services/agent`,
  `services/auth`, then `npm test`. If one test fails, nothing is deployed.
- Both deploy jobs have `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.
  A pull request only proves the code works; it never builds images, never touches AWS and never
  spends credits. Only merging to `main` deploys.
