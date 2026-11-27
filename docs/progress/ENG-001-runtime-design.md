# Development runtime

Use a pinned Node 24 image and TypeScript with Node's native type stripping for the API. The first runtime uses one HTTP entry point for health and the web shell, with PostgreSQL behind the Compose network. This keeps creator and respondent requests on one origin. Bring in the React build as the creator and respondent journeys are implemented. Add workers with the first durable background job.

The Compose setup is intended for development only. The web port is loopback-only and dynamically assigned in tests. PostgreSQL has no host port. The database credential in Compose belongs to the disposable fixture. Before any application data is accepted, split migration and application database privileges and enforce organisation and workspace scope at the database boundary.

Migrations run transactionally under a PostgreSQL advisory lock. Migration files are checked against recorded SHA-256 hashes. A missing or edited historical migration prevents startup. Apply new migration files for forward fixes. Reverting a migration requires a compatible forward migration or an approved restore.
