# Publish from saved survey details

ENG-006g depends on the immutable publication and conditional draft contracts in ENG-004 and ENG-005 and the saved multipage editor in ENG-006f. The workspace details, publication panel and browser journey are the owned paths. This change reuses the survey details capabilities, saved ETag, publication and close endpoints with no migration.

| Check                      | Expected behavior                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish from the workspace | An editor can reopen a saved draft, make an explicit audience choice and publish. The new response link and snapshot appear.                                                                            |
| Restricted publication     | University-only publishing requires a current approved policy. An unsuccessful request shows the error and leaves the existing publication intact. Public access requires a deliberate audience choice. |
| Stale draft                | The API receives the displayed draft ETag. A competing draft edit rejects publication and keeps the newly saved revision.                                                                               |
| Visible controls           | The edit capability is required for publication and closing. A closed survey shows neither action.                                                                                                      |
| End collection             | Confirmation closes all ordinary respondent links for the selected survey. Cancellation keeps them open. Answers and snapshots are retained, and authorised users can still open the latest report.     |

The browser tests cover explicit public and University access, response persistence in PostgreSQL, a delayed successful reply while workspace navigation is locked, cancellation with focus restoration, closure, and a real 409 when publication uses a stale draft revision.

## Follow-up acceptance

- Select an earlier publication in the workspace reporting view and verify its results and export after republishing and closing. The current reporting view opens the latest publication.
- Exercise multiple already-loaded respondent links across closure, policy withdrawal between selection and submission, and UI controls for editors and read-only members.
- Active Live Poll and Game Show rooms have their own presenter controls. The survey closure action applies to ordinary respondent links.
- Two tabs can publish the same saved draft revision. Their immutable snapshots are preserved, and a tab may need to reload its history to see the other publication. Abrupt browser navigation can also lose a newly issued plaintext link.
