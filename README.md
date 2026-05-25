# Jira UI

Start development server.

```
docker compose -f infra/compose/compose.dev.yaml up --build
```

Seed dev database with fake data.

```
DATABASE_URL=postgres://app:app@localhost:5432/jira_ui bun seed
```

Login to the Jira UI.

- Username: `admin`
- Password: `admin`
