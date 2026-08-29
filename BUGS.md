# Defect report — E-Commerce API

**Under test:** `https://us-central1-nn-api-challenge.cloudfunctions.net/api`
**Scope:** all six endpoints

**Nine defects, three of them critical.** Two are open security holes; one is losing money
on every multi-unit order.

Every finding was reproduced against the live API — twice, outside the Postman collection,
so the tests could not confirm their own results. Each one below carries a command you can
paste into a terminal to see it yourself.

They are also reproducible by importing the collection and pressing Run: **42 requests, 187
checks, of which 20 fail** — and every one of those failures traces back to a defect listed
here. The suite is deliberately small; requests that only re-proved a rule covered elsewhere
were removed rather than kept for the count.

> All commands assume `BASE=https://us-central1-nn-api-challenge.cloudfunctions.net/api`

---

## The short version

| # | The problem, in one line | Severity | Where |
|---|---|---|---|
| 1 | **You can log into anyone's account without their password.** | 🔴 Critical | `POST /login` |
| 2 | **Any customer can read any other customer's orders.** | 🔴 Critical | `GET /orders/:id` |
| 3 | **Buy 10 of something, get charged for 1.** | 🔴 Critical | `POST /orders` |
| 4 | You can buy more of an item than the shop has. | 🟠 High | `POST /orders` |
| 5 | Some products promise a description and do not have one. | 🟡 Medium | `GET /products/:id` |
| 6 | A quantity typed as text is accepted and stored. | 🟡 Medium | `POST /orders` |
| 7 | Stock never goes down, no matter how much is sold. | 🟡 Medium | `POST /orders` |
| 8 | One error returns a web page instead of an error message. | 🟡 Medium | `POST /orders` |
| 9 | Capital letters make a different account. | 🟢 Low | `POST /login` |

**Fix 1, 2 and 3 first.** The first two are a way in for anyone who wants one. The third is
losing money right now. **Fix 4 and 7 together** — they look like one bug and are not.

---

## 🔴 Why 1 and 2 together are worse than either alone

**All somebody needs is one email address.**

1. Log in as that person — **no password required** (defect 1).
2. Ask for order `o-1001`. It is not theirs; it is handed over anyway (defect 2).
3. Ask for `o-1002`, then `o-1003`. The numbers count upwards, so nothing needs guessing.

Three steps, no tools, nothing that looks unusual in a server log — every request is a
normal, valid, authenticated one. The result is every customer's name, email, order history
and spending.

**Fixing either one breaks the chain**, which is worth knowing if something has to ship today.

---

## How the testing was approached

For each documented rule I asked one question: *what would this API look like if the rule
were not implemented at all?* Then I wrote the test that tells the difference. All three
critical defects came out of that question — and none are visible from a happy-path check,
because the API returns `200` and looks healthy for all three.

Two decisions worth stating:

- **The tests assert the specification, not current behaviour.** A defect surfaces as a
  failing test rather than being quietly baselined as correct. That is why a clean run is
  partly red, and why those requests are tagged `[BUG-n]`.
- **Deciding something is *not* a defect carries the same burden of proof.** Every
  judgement call at the end of this report was verified the same way as the defects.

---

## Verification evidence

**Live product data at the time of testing:**

```json
{"id":1,"name":"Laptop","price":1000,"stock":15}
{"id":2,"name":"Keyboard","price":50,"stock":7}
{"id":3,"name":"Mouse","price":25,"stock":1}
{"id":4,"name":"Headset","price":80,"stock":28}
```

| # | What was checked | Observed | |
|---|---|---|---|
| 1 | Login with a deliberately wrong password | `200` + valid token | ✅ |
| 1 | Login with the password field removed | `200` + valid token | ✅ |
| 2 | Alice requests `o-1002` (bob's order) | `200` + `"user":"bob@qa.com"` | ✅ |
| 2 | Two accounts made minutes earlier, one reads the other's | `200` + the other user's email | ✅ |
| 3 | 2 × Keyboard (50 each) | total `50`, should be `100` | ✅ |
| 3 | 1 × Laptop + 2 × Headset | total `1080`, should be `1160` | ✅ |
| 4 | Mouse (`stock: 1`), qty 1 on two lines | `201 Created` | ✅ |
| 4 | Same total quantity on one line | `409 Conflict` | ✅ |
| 5 | Every product's detail page | ids 1 and 4: `isDetailed: true`, no description | ✅ |
| 6 | `qty: "2"` as text | `201`, stored as `{"productId":2,"qty":"2"}` | ✅ |
| 7 | Stock before / after successful orders | `15` → `15`, `1` → `1` | ✅ |
| 8 | Body `{"items": [` | `400`, `content-type: text/html` | ✅ |
| 9 | Register in capitals, log in in small letters | `201`, then `401 User not registered` | ✅ |

---

# The defects explanation

## 1. You can log into anyone's account without their password

**🔴 Critical.**

The login endpoint asks for an email and a password. It checks the email. **It never checks
the password.** Any password works. So does no password at all.

```bash
curl -X POST $BASE/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@qa.com","password":"definitely-not-the-password"}'
```

| Should happen | Actually happens |
|---|---|
| `401 Unauthorized`, no way in | `200 OK` and a working key to alice's account |

Leaving the password out entirely returns a working token too.

**A useful clue for whoever fixes it:** an email the system has **never seen** is correctly
turned away with `401 User not registered`. So the account lookup works fine. There is no
weak password check to strengthen — there is *no* password check. The fix is small and
lives in one place.

**Why it matters:** every account belongs to whoever wants it — and with defect 2, so does
every customer's order history.

**Tests:** folder 03, the two `[BUG-1]` requests.

---

## 2. Any customer can read any other customer's orders

**🔴 Critical.**

There are two questions a system must ask before showing you an order:

1. *Are you logged in?* — the API asks this, and gets it right.
2. *Is this order yours?* — **the API never asks this at all.**

Any logged-in person can read anybody's order: what they bought, what they paid, and their
email address. Order numbers run in a straight line — `o-1001`, `o-1002`, `o-1003` — so one
valid account plus a simple loop reads every order in the system.

```bash
TOKEN=$(curl -s -X POST $BASE/login -H 'Content-Type: application/json' \
  -d '{"email":"alice@qa.com","password":"pass123"}' | jq -r .token)

curl $BASE/orders/o-1002 -H "Authorization: Bearer $TOKEN"   # o-1002 is BOB's
```

| Should happen | Actually happens |
|---|---|
| `403 Forbidden` (or `404`, to avoid confirming it exists) | `200 OK` and bob's whole order |

**I removed the obvious objection before filing this.** Someone could fairly say *"alice and
bob are demo accounts, maybe the sample data is set up loosely."* So I registered two brand
new users, placed an order as one, and read it back as the other — two accounts thirty
seconds old with nothing to do with each other. Same result. It is not the demo data; there
is no ownership check anywhere.

**Why it matters:** this is a textbook IDOR (insecure direct object reference), and it is
invisible to any suite that only ever uses one account — which is exactly why the setup
creates two.

**Tests:** folder 05 `[BUG-2]` (alice reads bob's order) and folder 07 `[BUG-2]` (a fresh
stranger reads the first user's order).

---

## 3. Buy 10 of something, get charged for 1

**🔴 Critical.** Quietly costing money every day.

When you order several of the same thing, the till adds the price **once** and forgets to
multiply by the quantity.

```bash
curl -X POST $BASE/orders -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"items":[{"productId":2,"qty":2}]}'
```

| Should happen | Actually happens |
|---|---|
| total `100` (50 × 2) | total `50` |

A mixed basket pins down exactly what is wrong:

| Item | Price | Qty | Should cost |
|---|---|---|---|
| Laptop | 1000 | 1 | 1000 |
| Headset | 80 | 2 | 160 |
| | | **Correct total** | **1160** |
| | | **API charges** | **1080** |

`1080` is `1000 + 80` — one unit price per line, quantity ignored completely. That points
whoever fixes it straight at the loop that builds the total.

**Why this is so easy to miss:** a one-item order looks perfectly correct, because
multiplying by 1 changes nothing. Almost every smoke test orders one of something, so this
walks straight past them into production. That is why the collection places a single-item
order (which passes) immediately before the two-item order (which fails).

**What it costs** — the loss grows with basket size, so your best customers cost you most:

| Customer orders | Should pay | Actually pays | You lose |
|---|---|---|---|
| 1 headset | 80 | 80 | nothing |
| 2 headsets | 160 | 80 | **50%** |
| 10 headsets | 800 | 80 | **90%** |

**Why it matters:** direct revenue loss on every multi-unit order — and nobody will report
it, because the customer is being *under*charged. It surfaces only when someone reconciles
the books, which could be months.

**Tests:** folder 07, the two `[BUG-3]` requests.

---

## 4. You can buy more of an item than the shop has

**🟠 High.**

The shop does check stock — but it checks each **line** of the order separately instead of
adding up how many of that item you asked for in total. With 1 mouse left, asking for 1
mouse **twice on the same order** passes both checks, and you have bought two mice that do
not exist.

```bash
curl -X POST $BASE/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":3,"qty":1},{"productId":3,"qty":1}]}'    # stock is 1
```

| Should happen | Actually happens |
|---|---|
| `409 Conflict` — you asked for 2, we have 1 | `201 Created` |

**The rule itself works fine.** Asking for `qty: 2` on a single line is correctly refused
with `409`. Only the adding-up is missing.

**Please fix this together with defect 7.** They look like one bug wearing two hats:
defect 7 is that the stock number never drops; defect 4 is that the check does not sum the
lines. **Repairing the stock counter alone leaves this hole exactly as wide as it is now.**

**Test:** folder 06, `[BUG-4]`.

---

## 5. Some products promise a description and do not have one

**🟡 Medium.**

The documented rule: if `isDetailed` is **true**, the product must have a `description`.
Two products say `true` and have none.

```
GET /products/1  →  {"id":1,"name":"Laptop","price":1000,"stock":15,"isDetailed":true}
                                                          ↑ says it has one … it does not
```

Products 1 (Laptop) and 4 (Headset) are affected. Products 2 and 3 do it correctly and
*do* carry descriptions — so the code clearly *can* attach one. That makes this a data gap
rather than a missing feature.

**Why it matters:** any app trusting that flag to draw a "Product details" panel will show
an empty box or crash reading something that is not there.

**On how it was tested:** rather than checking products 1 and 4 by name, the test walks
through **every** product the API has. When a tenth product is added next month, it is
covered automatically. That is the difference between testing today's data and testing the
rule.

**Test:** folder 04, `[BUG-5]`.

---

## 6. A quantity typed as text is accepted and stored

**🟡 Medium.**

There is a difference between the number `2` and the text `"2"`. The API is careful about
the *value* of a quantity — `1.5` is correctly refused — but it never checks the *type*.

```
201 Created → {"items":[{"productId":2,"qty":"2"}],"total":50}
                                        ↑ text, sitting in your data
```

**Why it matters:** the contrast is the useful part. `1.5` is rejected, so the code *does*
look at quantity — it just never asks what kind of thing it is looking at. Unchecked text
then flows into storage and into the sums that follow. Every client library eventually
sends a number as text by accident, and this is the kind of thing that quietly corrupts
data for months. Depending on the order of operations, a value like `"1e9"` may well slip
past the stock check the same way.

**Test:** folder 06, `[BUG-6]`.

---

## 7. Stock never goes down, no matter how much is sold

**🟡 Medium.**

Place an order. It succeeds. The stock level has not moved. Product 3 sits at `stock: 1`
forever, however many times it is sold.

```bash
curl $BASE/products                       # note the stock numbers
curl -X POST $BASE/orders ...             # place a real order
curl $BASE/products                       # identical
```

**Why it matters:** the shop will happily sell the same single item to a hundred people;
ninety-nine get a confirmation for something that does not exist.

The strange part is that the API **does** enforce "Insufficient stock" when you order too
much at once. The check is there — it is just guarding a number that never changes.

**On how it was tested:** this data lives in memory and resets, so a test asserting "stock
should be 14" would be wrong within the hour. Instead the test takes a reading, places an
order, takes another reading, and compares the two **within the same run** — true no matter
what the numbers happen to be today.

**Test:** folder 07, `[BUG-7]`.

---

## 8. One error returns a web page instead of an error message

**🟡 Medium.**

Every error this API produces looks like `{"error": "..."}` — except one. Send a malformed
body and you get back an actual **HTML page**.

```bash
curl -X POST $BASE/orders -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"items":['
```

Returns `400` with `<!DOCTYPE html>...<pre>Bad Request</pre>`.

**Why it matters:** an app hitting an error tries to read the message out of it. Here there
is no message — there is a web page — so the app throws an error of its own. An ordinary
"please check your basket" becomes a white screen and a crash report. It also puts the
framework's default error page on public display.

**How it was found, honestly:** by accident. A "every response must be JSON" check runs
against every request in the collection, and this one tripped it. That is a decent argument
for one or two cheap assertions that apply to absolutely everything — they cost nothing and
occasionally catch what nobody thought to look for.

**Test:** folder 06, `[BUG-8]`.

---

## 9. Capital letters make a different account

**🟢 Low — filed as a question, not a defect.**

Sign up as `QACASE1@example.com`, then try to log in as `qacase1@example.com`. You get
`401 User not registered`. The same address to any human being; two different accounts to
the API.

**Is it a bug?** Genuinely arguable, which is why I am not calling it one.

- **For leaving it:** the email standard (RFC 5321) really does say the part before the `@`
  is case-sensitive. The API is within its rights.
- **For changing it:** almost every real email provider ignores capitals. Someone signing up
  on a phone, where the first letter auto-capitalises, will later swear their account has
  vanished — and since registration accepts both spellings, one person can end up with two
  accounts and a support ticket.

**Recommendation:** lowercase addresses on both register and login. But that is an opinion
about how the product should behave, not a broken rule — **so the test asserts what the API
does today and passes.** I am not going to turn someone's build red over an opinion of mine.

**One note about the test environment.** My first version of this test asserted that
`ALICE@qa.com` returns `401`. It passed when written and started failing an hour later when
somebody registered that address. **This is a shared sandbox and other people's data is in
it**, so any assertion leaning on data I do not own is flaky through no fault of the API.
The test now registers its own capitalised address and logs in with the lowercase version —
self-contained, and it gives the same answer no matter who else is testing today.

**Tests:** folder 03, the two requests around `[QUESTION-9]`.

---

# Things that look wrong but are not

Not everything unusual is a defect. Each of these was investigated, verified against the
live API, and deliberately **not** filed — so you can see it was considered, not missed.

| What I looked at | What I found | Why it is not a defect |
|---|---|---|
| Seeded users get `403 Seeded users cannot create orders` | Every order placed as alice is rejected | **Deliberate** — it protects shared demo data from everyone testing this API. My first instinct was that `POST /orders` was broken; it is not. I registered my own users instead. Kept as a **passing** `[BY DESIGN]` test, so you still hear about it if the policy changes. |
| Bad token → `403`, missing token → `401` | Consistent across repeated runs | I would expect `401` for both (`401` = "I do not know who you are"). But it is consistent and nothing leaks, so the tests accept either. Worth a code-review comment, not a defect report. |
| `GET /products` omits `isDetailed` and `description` | Only id, name, price, stock | **Correct.** Those fields belong to the single-product endpoint, and small list responses are good practice. |
| A password of exactly 6 characters | `201 Created` | **Correct.** The rule is "at least 6", so 6 must be allowed. 5 was tested too (rejected) — a boundary has two sides. |
| Ordering exactly the stock available | `201`, then `409` for one more | **Correct.** The line is drawn in the right place. |
| The same product on two separate lines | Totals add up correctly | Reasonable basket behaviour. Only the **stock check** across lines is broken — that is defect 4. |
| Request with no `Content-Type` | `400 "items must be a non-empty array"` | The body is never parsed, so the message misleads — `415 Unsupported Media Type` would be clearer. But it is safely rejected. Polish, not a defect. |

---

# What I would do next

**Today, in this order:**

1. **Defect 1 or 2** — either one breaks the attack chain. Both, ideally; but if only one
   thing ships in the next hour, one is enough to stop the bleeding.
2. **Defect 3** — every multi-unit order is undercharged until this is fixed, and money
   already lost is hard to recover.
3. **Defects 4 and 7 together** — the pairing matters. Fixing the stock counter alone still
   leaves you able to oversell.

Everything else can wait for a normal sprint.

**Not covered, in the order I would pick it back up:**

- **Two orders racing for the last item.** Given defect 7 I expect this is broken too, but
  expecting is not evidence, and I would not file what I could not reproduce.
- **Token expiry.** Tokens are stated to last an hour; I did not wait for one to lapse.
- **Rate limiting on registration.** Appears unlimited. I stopped short of hammering a
  shared sandbox to prove it.
- **Very large quantities.** Defect 6 makes me suspect a value like `"1e9"` slips past the
  stock check the same way the text `"2"` does.
- **Whether long passwords are silently truncated.** Registration accepts a password of any
  length — 200 and 1000 characters both work — but truncation cannot be proven while
  defect 1 stands: logging in with a shortened version of the password succeeds, and so
  does logging in with a completely wrong one. **This becomes testable the moment defect 1
  is fixed**, and it is worth re-checking then.

**One thing for a planning conversation rather than a bug report:** all three critical
problems are *missing* checks, not broken ones. The password comparison, the ownership
check, the multiplication — none are wrong, they are absent. That pattern usually means the
tests were written against the happy path, so nothing ever asked whether the rule was there
at all. Worth discussing alongside the fixes, because the next feature will likely arrive
the same way.
