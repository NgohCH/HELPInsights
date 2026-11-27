# Survey Template Library — Authoring, Review and Governance

## Objective

Help staff start quickly with vetted examples while demonstrating features. Templates are starters, not guaranteed scientifically valid instruments.

## Initial curated templates and capability showcase

| Template | Type | Demonstrates |
|---|---|---|
| Project Listen pulse | Feedback | rating, open text, anonymous/identified choice, response trend |
| Student satisfaction | Survey | Likert, section/page breaks, conditional follow-up |
| Event/training evaluation | Evaluation | NPS/rating, matrix, optional comments, report |
| Staff experience | Survey | invitation and privacy notices, aggregated reporting |
| Quick vote | Poll | one/few questions, scheduled closing, results visibility |
| Pop quiz | Quiz | scored choices, correct answers, feedback, attempt policy |
| Service feedback | Feedback | category, follow-up consent, safe external case handoff |
| Academic research starter | Research | consent, stable variable codes, data dictionary and export |
| Field collection sample | Kiosk/offline | device/session protections, sync conflict handling |

Each template includes: immutable ID and revision, author/publisher, organisation visibility (global/org/workspace), summary, intended audience, estimated completion time, sample question count, question/page schema, survey-type profile, supported languages, required feature flags, data classifications, retention guidance, accessibility check, preview fixture and **licence/usage permission**. Templates involving validated scales require explicit instrument provenance/rights; none should be falsely labelled validated.

## Lifecycle

Draft -> content review -> accessibility/security/privacy review -> publish -> supersede/archive. Users **clone** an authorised template to their workspace; master templates stay immutable. New template revisions never overwrite an existing survey's published schema.

Template preview must use fake data and must not create real responses. Organisation admins can manage their own libraries; platform operators cannot automatically see private respondent data.

## Tests

Seed fixtures into real PostgreSQL; preview renders in browser; clone creates independent draft with correct version/permissions; out-of-tenant clone forbidden; unavailable feature gives clear request path; archived template cannot start new survey; existing surveys remain functional after retirement. Run visual, keyboard and mobile tests.
