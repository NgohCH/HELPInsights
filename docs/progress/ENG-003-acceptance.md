# Tenant and session acceptance

ENG-003 depends on the verified bootstrap stack. Own the session and workspace HTTP routes, PostgreSQL roles and tenant membership policy, and their tests.

- Anonymous or expired session calls to /me and /workspaces return 401. A workspace header supplies no authority.
- A valid session sees its own profile and exactly the workspaces for which the actor has active membership. An operations fixture without membership sees an empty list.
- Run direct SQL as the non-owner runtime role with the verified actor in the transaction context. Only the member workspace and membership rows are visible. A new transaction without actor context returns zero rows.
- The API database role cannot create an organisation or enumerate session hashes. Migration ownership stays outside the HTTP process.
- Use independent synthetic fixtures. No external identity provider or production token is needed for this local seam.
