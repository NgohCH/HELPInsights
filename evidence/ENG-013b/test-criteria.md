# ENG-013b answer label piping criteria

- A saved question can append the label of an option selected in an earlier unconditional single-choice question, on the same or a preceding page. The definition stores one stable source question ID. Its plain title is the fallback when there is no known selection.
- Canonical draft validation rejects an unknown, self, forward, non-choice or conditionally visible source and malformed source values. Reordering or removing a referenced question fails without changing the draft. Legacy definitions remain unchanged.
- A synthetic creator saves the reference in the editor and reopens it. Real Chromium sees the fallback, selected label and replacement label in saved draft preview and in the published public form. Angle brackets, quotes and punctuation remain text in both form labels and choice legends.
- Real HTTP rejects invalid drafts without changing PostgreSQL. PostgreSQL stores the source reference and plain title in both the draft and immutable version. Preview writes no responses. Published submission stores the original answer codes, and the server rejects display labels as answer values.
- Changing a controller to hide a piped target discards its previous value. Revealing it starts with an empty input, and submitting while it is hidden stores no answer for that target.
- The editor exposes a keyboard-operable source disclosure. Only the active question renders a picker and its options. Closing the picker leaves the selected source visible, and reopening the saved editor restores its source.
- Focused red and green model, HTTP/PostgreSQL and Chromium evidence precede independent review and the full runtime gate.
