# Saved draft multipage editing acceptance

The editor applies structure changes to a private draft and submits the whole canonical definition through the existing conditional draft write. Published versions are immutable.

| Check                   | Expected behavior                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft structure         | Add, remove and reorder pages and supported questions. Moving a question across pages preserves in-progress wording, and saved page names are retained.                    |
| Visibility validation   | A controller remains earlier than every question that uses it. Invalid reordering or removal gives an error and leaves the draft intact.                                   |
| Keyboard and focus      | Move controls work with Enter. The live region identifies the destination page and position after repeated moves. Focus follows the edited page title or question wording. |
| PostgreSQL and reload   | Direct SQL confirms the complete saved order, stable IDs and codes, descriptions, visibility and unchanged published version. The browser can reload the new draft.        |
| Existing draft revision | A stale conditional write is rejected and leaves the persisted draft intact. The existing workspace regression covers this revision contract.                              |

## Release checks still needed

- Exercise an edited draft near and above the 65,536-byte request body limit. A definition can satisfy the page and question limits while exceeding the save limit. Verify that authors can recover their local edits and provide clear size feedback before broad release.
- Exercise competing structural edits from two browser sessions. The existing PostgreSQL-backed workspace regression covers a stale title save. The structural workflow still needs direct coverage of preserving both local edits and the winning database revision when two editors reparent or remove questions concurrently.
