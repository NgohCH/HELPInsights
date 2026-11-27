# ENG-013a conditional question visibility

Prerequisites are verified survey versions, anonymous submission and saved preview. Own the shared definition and response validation, shared question renderer, API contract and synthetic tests.

- An earlier unconditional single-choice answer controls a later question by stable option code. No condition preserves existing behavior.
- Draft validation rejects a missing, self or forward controller, a conditionally visible or non-choice controller, and an unknown option. The public version preserves a valid condition.
- A hidden required question may be omitted. A supplied answer for a hidden question receives 400 and never reaches persistence. A visible required question must have a valid answer.
- In mobile Chromium a respondent can toggle the controller with the keyboard. When a dependent field disappears its unsaved value is discarded. Verify a durable anonymous response with only the visible answer.
- Run real Docker PostgreSQL, Chromium, full regression checks and independent privacy review. The creator can add one required text follow-up for either single-choice option, save and validate answers in a private mobile preview. Its saved definition is in PostgreSQL with no published version. General logic editing remains separate.
