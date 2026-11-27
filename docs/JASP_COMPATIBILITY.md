# JASP compatibility and research export interoperability

## Purpose and release policy

**JASP:** https://jasp-stats.org/ . This document defines a specific, testable interoperability promise. JASP is an external statistical analysis program; our platform generates datasets JASP can consume and does not embed or modify JASP.

**Stage 1 (Project Listen): mandatory** `jasp_csv_bundle` export alongside standard `csv_bundle`. **Stage 1B:** operational feedback-to-action stabilisation for initial production deployment. **Stage 2:** improve data preparation UI. **Stage 3:** add labelled SPSS `.sav` research exports and test JASP interoperability. Development of these capabilities may occur concurrently; production activation remains subject to release gates.

## Verified JASP format support

JASP officially lists CSV/TSV, Excel `.xls/.xlsx`, SPSS `.sav/.zsav/.por`, and other statistical formats among files it opens. Its getting-started documentation distinguishes **nominal**, **ordinal**, and **scale** variables and explains that automatic type detection can require manual correction. Sources:
- https://jasp-stats.org/faq/file-formats-jasp-support/
- https://jasp-stats.org/getting-started/
- https://jasp-stats.org/

## Stage 1 export contract: ZIP

`POST /api/v1/surveys/{surveyId}/exports` with `{ "format": "jasp_csv_bundle" }` creates a protected asynchronous export job. On completion, return a short-lived authenticated download URL. ZIP must contain:

1. `responses.csv` — one row per exported response, one fixed machine-safe column per question/variable; UTF-8 (BOM decision documented), RFC 4180-compatible quoting, predictable missing data representation, stable variable names. Include response ID only when privacy policy permits, and avoid all respondent-identifying fields in anonymous mode.
2. `codebook.csv` — variable name, stable question ID, readable question label, questionnaire version, level `nominal|ordinal|scale|text`, permitted value codes and their labels, order for ordinal values, missing-value codes, and transformations. The word `text` is our export metadata category, **not** an extra JASP measurement type; users must select the appropriate JASP variable type for text fields.
3. `manifest.json` — schema version, survey ID/version, export timestamp UTC, column order, counts, inclusion/exclusion filters, locale, privacy mode, file checksums and known limitations. Manifest must not contain raw answers or secrets.
4. `IMPORT_IN_JASP.md` — import steps (File > Open; select `responses.csv`), verify column headers, nominal/ordinal/scale measurement types, recode/missing values as needed, consult codebook, then save a local `.jasp` analysis file in an approved location. Explicitly warn that CSV **does not carry JASP-native measurement levels and labelled value metadata automatically**.

### Data conventions

- Use stable ASCII machine-safe variable codes; preserve Unicode question text and value labels separately. Never use display labels as unstable column headers.
- Likert/rank items are marked `ordinal` in metadata; don't assume these are interval/scale. Derived numerical scores are `scale` only where justified and documented.
- Distinguish skipped/not displayed, respondent refusal and unanswered where available; specify how each maps to missing values and keep exports consistent.
- Date/time: ISO 8601 with timezone, with documented transformations for JASP if dates are treated as text.
- For multi-select questions, use documented separate 0/1 indicator columns or another fixed documented representation, not variable-width lists.
- CSV formula injection mitigations must be applied to human-controlled text without corrupting numeric response codes; describe transformations in the manifest.
- Ensure export permissions, privacy, retention holds, download expiry and audit logging. No silent re-identification.

## Stage 3 enhanced export

Generate `.sav` with supported variable labels, value labels and numeric types from a controlled library/tooling path. Verify round-trip fidelity and open the file in JASP. Study exports may add scored/reverse-coded variables, randomisation allocation, participant-wave linkage where authorised, missingness annotations and provenance. Native `.jasp` format is **not required**: it is an analysis project format, not an ordinary interchange target.

## Test and release evidence

- Fixture A: five-point Likert items (order and labels), nominal 2/3-category variables, scale values (decimals).
- Fixture B: English, Malay and Chinese text, commas/quotes/newlines, null/blank, partially completed responses.
- Fixture C: multi-select, anonymous survey, denied access and retention-expired data.
- Automated: schema checks, row count, column order, codebook linkage, valid UTF-8, date handling, CSV escaping and privacy safeguards.
- Manual: import Stage 1 bundle in the currently supported JASP desktop release and record variable-type corrections/screenshots; compare counts and values. Stage 3 manual `.sav` JASP import is a mandatory gate.
- Report precise JASP version, OS, fixture version and test results in `docs/progress/WP-007.md` (Stage 1) or Stage 3 work package evidence.

## Explicit non-goals

No JASP embedding, automated JASP analysis, forced JASP installation, reverse-engineered `.jasp` writer, or implied licence to redistribute JASP binaries. Do not claim that a CSV bundle automatically preserves native JASP column types/labels.
