# Testing BuildSupply

## What is a unit test?

A unit test is a small piece of code that calls one function with a known
input and checks that the answer is exactly what we expect. For example:

```ts
expect(lineGst(1000, 18)).toBe(180) // 18% GST on ₹1,000 is ₹180
```

If someone changes `lineGst` later and it starts returning 179, this test
fails straight away, before the change ever reaches a supplier's phone.

## Why start with money and dates?

- **They are the most expensive to get wrong.** A wrong GST figure or a
  wrong balance on a bill causes an argument with a customer, or a tax
  problem. A slightly misplaced button doesn't.
- **They are pure functions.** Same input, same output, no database, no
  screen, no internet. That makes them quick and reliable to test: all the
  tests here run in about two seconds.
- **They are easy to break without noticing.** A one-character change to a
  rounding rule looks harmless in code review.

What is covered (all in `src/lib/`, each test file sits beside its source):

| File | What it checks |
|---|---|
| `gst.test.ts` | GST per line, rounded to whole rupees the way the database does it; the 18% fallback; the GST switch; tax grouped by rate on a bill; how a rate is printed |
| `amountInWords.test.ts` | The balance written in words, in Indian numbering (Thousand, Lakh, Crore) |
| `numberInput.test.ts` | Cleaning what a supplier types into quantity, rate and phone boxes |
| `whatsapp.test.ts` | Turning a phone number into one WhatsApp accepts |
| `localDate.test.ts` | Which calendar day a timestamp belongs to in India |

## How to run them

From the `frontend` folder:

```bash
npm test
```

runs every test once and prints how many passed.

```bash
npm run test:watch
```

keeps running and re-runs the tests every time a file is saved, which is
handy while changing one of these helpers.

They also run automatically on GitHub for every push and pull request
(`.github/workflows/frontend-ci.yml`), together with lint and the build.

## The two regression tests

A regression test protects against a bug that really happened coming back.

1. **WhatsApp country code** (`whatsapp.test.ts`). Phone numbers are saved
   as 10 digits, like `9800000000`. WhatsApp's `wa.me` links need the full
   international number, `919800000000`. Early on the app sent the number
   without the `91` (and sometimes with India's leading `0`), so WhatsApp
   answered "phone number shared via url is invalid" and every WhatsApp
   button in the app looked broken. The test feeds in the ways suppliers
   really type numbers and checks each one comes out as `91…`.

2. **IST dates** (`localDate.test.ts`). The database stores every time in
   UTC, but suppliers live in India, which is 5 hours 30 minutes ahead. The
   app used to take the date straight from the UTC time, so a bill made at
   1:30 am in India was filed under the previous day — 3 of 20 bills and 5 of
   25 payments in the real data were on the wrong day in reports and
   ledgers. The test checks that 1:30 am and midnight IST land on the new
   day, and 11:59:59 pm stays on the old one.

## What the TZ setting does

`vitest.config.ts` sets `TZ: 'Asia/Kolkata'`. `TZ` tells Node which
timezone to pretend the computer is in. Without it, the date tests would
give different answers on different machines: they would pass on a laptop
in India and fail on GitHub's servers, which run in UTC. Setting it makes
every run behave like a supplier's phone in India.

The first test in `localDate.test.ts` checks the setting actually worked
(India is 330 minutes ahead of UTC). If it ever stops working, that test
fails with a clear message instead of the date tests quietly checking the
wrong thing.

## Safety rules for these tests

- Tests only import pure helpers from `src/lib/` — never Supabase,
  `services/` or `context/`.
- `vitest.config.ts` sets `envDir: false`, so tests never read `.env` and
  never see the live project's address or key.
- `src/test/noNetwork.ts` makes any `fetch` inside a test throw an error, so
  a test can never reach the internet or the live database by accident.

## A behaviour noticed, not changed

`amountInWords(1)` returns "One Rupees Only" (plural). The test records the
current behaviour; whether to change it to "One Rupee Only" is a separate
decision.
