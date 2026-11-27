# Creator and respondent browser acceptance

Run Chromium against the isolated Compose app and PostgreSQL. Give the creator a random time-limited development session and a synthetic workspace with a retention policy. Create a survey with one question and two labelled options. Save a draft, publish it, and follow the public respondent link from a separate mobile browser context without a session. Use the keyboard to choose an answer. Submit once and independently assert its saved answer code in SQL. Capture browser and SQL failures.

The local sign-in accepts a seeded synthetic session. External identity and all production release checks retain their own gates.
