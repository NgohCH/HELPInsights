# ENG-006d guided after-class feedback criteria

The scope is one purpose-led starting point for a creator authorised in a workspace, using the ordinary versioned survey definition and anonymous link. The existing simple, template and entitled NPS paths remain available.

- A keyboard-only creator can choose after-class feedback, edit the five prompts and their choice labels, and go back before saving. Unsubmitted edits survive a round trip between starting points. After a draft exists, the workspace and starting point stay fixed.
- The creator sees the anonymous access and workspace-retention explanation before saving and publishing. Saving uses the existing workspace and retention permission checks and draft revision.
- Saved preview shows the actual five-question snapshot, accepts fixture answers in the browser, and creates neither a published version nor a response. Later edits disable publication until saved again.
- The explicit publication action carries the saved draft ETag. A concurrent update makes that precondition fail inside the locked transaction and leaves the creator on the saved draft. Headerless API publication remains supported. SQL proves no version or distribution is created on conflict.
- The published link opens in a separate browser context without a creator session. Five valid synthetic answers are accepted and stored against the immutable version. Editing the private draft after publication never changes the existing link's definition.

Other purposes, release governance, live delivery, durable wizard resume, expert editing and screen-reader/mobile usability evaluation remain open.
