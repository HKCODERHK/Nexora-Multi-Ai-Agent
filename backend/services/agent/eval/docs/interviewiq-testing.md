# Testing the InterviewIQ server

## How to run

```bash
cd server
npm install
npm test          # run once
npm run test:watch  # re-run on every save
```

The first run downloads a MongoDB binary (about 100 MB), so it is slower. After that the tests take a few seconds. You don't need a `.env` file, internet access to Razorpay or OpenRouter, or a real database.

## The tools

**Vitest** is the test runner. It finds every `tests/*.test.js` file, runs the `it(...)` blocks and reports which passed.

**Supertest** sends real HTTP requests to the Express app without starting a server on a port. `app.js` builds the app and `index.js` starts it, so a test can `import app from "../app.js"` and call `request(app).post("/api/payment/verify")`. The request goes through the real middleware (cookies, `isAuth`, JSON parsing) and the real controller, the same way a browser request would.

**mongodb-memory-server** starts a real MongoDB in memory before the tests and throws it away afterwards. Mongoose talks to it exactly as it talks to Atlas, so queries, updates and atomic operations behave the same way. Every collection is emptied after each test, so tests don't affect each other. See `tests/setup.js`.

## Mocking

A mock is a fake version of a module that the test controls. `vi.mock("../services/razorpay.service.js", ...)` replaces the real Razorpay client with an object whose `orders.create` returns `{ id: "order_test_1", ... }` and records what it was called with.

Razorpay and OpenRouter are mocked because:

- the tests must not create real orders or spend real money or AI credits,
- they need no API keys, so no secrets in CI,
- they don't depend on the network, so they are fast and give the same result every time,
- a test can check exactly what the app sent, for example "amount was 100 × 100 = 10000 paise".

The secrets in tests are fake too (`JWT_SECRET=test-jwt-secret`, `RAZORPAY_KEY_SECRET=test-razorpay-secret`). They are set in `tests/setup.js`.

## How the payment signature check works

1. After a payment, Razorpay gives the browser `order_id`, `payment_id` and `signature = HMAC-SHA256(order_id + "|" + payment_id, key_secret)`.
2. Only Razorpay and our server know `key_secret`, so the server computes the same HMAC and compares it with `crypto.timingSafeEqual`, which takes the same time whether or not the values match.
3. If they don't match, someone changed the data, so the server returns 400 and adds no credits.

The tests build valid signatures with the fake secret (`sign()` in `tests/helpers.js`), then change one character, or sign a different payment ID, and check that both are rejected.

## The double-credit race condition

**Before:** `verifyPayment` did three separate steps:

1. `findOne` the payment
2. if `status === "paid"`, stop
3. otherwise set `status = "paid"`, `save()`, and add credits

If two identical requests arrive at the same moment (a double click, a retry), both can finish step 1 before either reaches step 3. Both see `"created"`, both pass the check, and the user gets 100 credits for a 50-credit purchase. The test `credits only once when identical requests arrive at the same time` fired two requests with `Promise.all` and reproduced this: both returned "credits added".

**After:** steps 1 to 3 are one atomic database operation:

```js
Payment.findOneAndUpdate(
  { razorpayOrderId, status: "created" },
  { $set: { status: "paid", razorpayPaymentId } },
)
```

MongoDB applies this to the document as a single operation, so only one request can change `"created"` to `"paid"`. That request gets the document back and adds the credits. The other gets `null` and replies "Already processed". It doesn't matter how many requests arrive at once: the order is credited once.

## What is covered

- `tests/auth.test.js`: the `isAuth` middleware (no cookie, garbage token, expired token, token signed with another secret, valid token, deleted user), the login cookie flags (`HttpOnly`, `Secure`, `SameSite=None`) and logout clearing the cookie.
- `tests/payment.test.js`: creating an order (validation, amount in paise, saved `Payment`) and verifying it (valid signature, tampered signature, wrong payment ID, wrong-length signature, unknown order, repeated request, parallel requests, not logged in).
- One skipped test documents a known issue in `POST /api/auth/google`: it trusts the email sent in the request body. It will be un-skipped once the server verifies Google ID tokens.

CI runs the same `npm test` on every push and pull request (`.github/workflows/server-tests.yml`).
