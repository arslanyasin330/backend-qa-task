# E-Commerce API — QA Test Suite

A Postman-based API test suite covering **authentication, products, and orders**, along with a clear defect report.

The goal was simple: **verify that the API works correctly, validate the business rules, and identify any issues that could impact users or the business.**

## 📁 Project Structure

```text
postman/
├── ecommerce-api-tests.postman_collection.json
└── ecommerce-api-environment.postman_environment.json

BUGS.md          → Detailed defect report
scripts/         → Optional test/CI utilities
.github/         → Optional CI pipeline
```

## 📊 Test Coverage

* **42** API requests
* **187** assertions
* **6** endpoints covered
* **9** defects identified
* **3 Critical** issues found

The tests cover:

* Authentication & login
* Products and product details
* Product validation
* Orders and quantities
* Stock validation
* Response structure and data types
* HTTP status codes
* Response time and content type

The suite is deliberately small. Requests that only re-proved a rule already covered elsewhere were removed rather than kept for the count, and not one of the failures changed. Everything that remains either catches a defect, guards a boundary, or documents a judgement call.

## ▶️ How to Run

1. Import both files from the `postman/` folder into Postman.
2. Select **E-Commerce API - Test Environment**.
3. Open the collection and click **Run**.

That's it.

The collection creates its own test users and uses live product data, so there is **no manual test data setup required**.

> Step 2 is the one people skip. If everything fails with an address error, that is why.

To run it headless instead:

```bash
npm install && npm test
```

## ⚠️ About the Failed Tests

You may see some tests fail — **this is expected**.

The failing tests represent known API defects. They are intentionally written to fail when the API does not behave as expected.

| Tag            | Meaning                                             |
| -------------- | --------------------------------------------------- |
| No tag         | Normal test — should pass                           |
| `[BUG-n]`      | Expected failure proving a known defect             |
| `[QUESTION-n]` | Behaviour that needs product/business clarification |
| `[BY DESIGN]`  | Confirmed expected behaviour                        |

**Any unexpected failure without a `[BUG-n]` tag should be treated as a regression.**

This is checked by [`scripts/check-results.js`](scripts/check-results.js) rather than just claimed, because a test runner's exit code cannot tell a known defect from a new one.

## 🐞 Key Findings

I identified **9 issues**, including:

| # | Issue                                               | Severity    |
| - | --------------------------------------------------- | ----------- |
| 1 | Login possible without a password                   | 🔴 Critical |
| 2 | Users can access other customers' orders            | 🔴 Critical |
| 3 | Incorrect price calculation for multiple quantities | 🔴 Critical |
| 4 | Stock validation can be bypassed                    | 🟠 High     |
| 5 | Missing description with `isDetailed: true`         | 🟡 Medium   |
| 6 | Quantity accepts text values                        | 🟡 Medium   |
| 7 | Stock is not reduced after an order                 | 🟡 Medium   |
| 8 | Invalid JSON returns HTML                           | 🟡 Medium   |
| 9 | Email matching is case-sensitive                    | 🟢 Low      |

Full details, reproduction steps, and expected/actual behaviour are available in **[`BUGS.md`](BUGS.md)**.

Every finding was reproduced directly against the live API, outside the collection, before it was written up — so were the judgement calls, because deciding something is *not* a defect deserves the same evidence as deciding that it is.

### 🔴 Highest Priority

The most important finding is the combination of the first two issues:

A user can log in **without a password** and can then access **other customers' orders**.

All somebody needs is one email address. Order numbers run in sequence, so there is nothing to guess. This creates a serious security and privacy risk and should be addressed first — and fixing *either one* breaks the chain, which is worth knowing if something has to ship today.

The incorrect quantity/price calculation is also critical because it can directly result in **revenue loss**. It is easy to miss: a single-item order looks perfectly correct, because multiplying by 1 changes nothing.

## 🔍 QA Approach

The tests don't only check whether an API returns `200`.

Each important request validates:

**Status Code → Response Structure → Data Types → Business Rules**

This means an API returning `200` with incorrect data will still fail the test. All three critical defects return `200` and look perfectly healthy on a happy-path check.

The suite also uses live product IDs, prices, and stock values where possible, making the tests less dependent on hard-coded data. This matters here because the data is held in memory and resets from time to time — a test asserting "stock should be 14" would be wrong within the hour.

## 💡 Additional Validation

During testing, I also checked behaviours that were not initially obvious, including:

* Invalid authentication
* Missing/invalid request data
* Response content type
* Response time
* Stock behaviour
* Quantity validation
* Product detail rules
* Existing seeded data behaviour

Some unusual behaviours were investigated and intentionally **not reported as defects** when they appeared to be by design or required product clarification. These are listed in `BUGS.md` so you can see each one was considered rather than missed.

## 📌 Deliverables

**Main deliverable:**
`postman/ecommerce-api-tests.postman_collection.json`

**Supporting files:**

* `ecommerce-api-environment.postman_environment.json`
* `BUGS.md`
* Optional CI/reporting scripts

The collection can be imported into Postman and executed directly with minimal setup.
