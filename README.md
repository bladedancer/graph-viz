# Graph Visualizer

Sign in to an Amplify Fusion tenant and explore its configuration as an interactive, physics-driven graph. Pick one or more
root resource types (API, Application, Project, …) to read them from the tenant's JSON:API config model, then load the
relationships you care about, all at once or one resource at a time. Resources are drawn as nodes you can drag, pin, search,
filter and export.

## Run it

**In a container** (recommended). Builds the image and publishes it on localhost only:

```sh
scripts/start.sh            # http://localhost:8080
PORT=9000 scripts/start.sh  # http://localhost:9000
```

Uses Docker, or Podman if that's what you have (`CONTAINER_RUNTIME=podman` to choose). Settings from the table below are passed
through when set in your shell.

**Without a container** (Node 22.12 or newer):

```sh
npm install
npm run build
npm start                   # http://127.0.0.1:8080
```

Then open the app, enter your tenant URL (for example `https://acme.fusion.example.com`), email and password, choose root
resource types and select **Load graph**.

## Using it

- **Environment** (Design, Check, Live) in the header picks which environment of the tenant is read; it is sent as the
  `Env-Mode` header on every request. Changing it reloads the graph, since each environment has its own data.
- **Root resources** is a multi-select of the resource types the Fusion graph model exposes at the top level, each with its
  record count in your tenant (a dash where the tenant doesn't report one). Types the tenant can't list at all are shown but
  disabled.
- **Load graph** reads the selected root types, up to **Per type** each (up to 10,000), and shows them as nodes. It does not
  load relationships; the status line says how many related resources are still not loaded.
- **Load relationships** (toolbar, or under Source) loads what the loaded resources relate to and follows on from there, up to
  **Max resources** (up to 100,000) in total. Related resources are loaded in bulk, a page of up to 100 per request.
- **Double-click** a resource to load its relationships one level deep. **Shift + double-click** loads everything reachable from
  it. Its details panel has the same actions.
- Click a resource for its attributes, relationships and raw data. Drag to pin it; right-click it (or **Unpin** in its details)
  to release it. Search and _Include connected resources_ dim everything else. **Layout** tunes the physics or pauses it;
  **Colors** groups by project or type. **Export PNG** saves the current view.

## Why there is a server

The tenant's CORS policy only allows its own origins, so a browser can't call its sign-in or config APIs from anywhere else
(checked against a live tenant: `Access-Control-Allow-Origin` is sent for the tenant's own hosts and no other). The small Node
server signs in on your behalf, keeps the access token in memory (the browser only gets an HttpOnly, SameSite=Strict cookie),
and crawls the config API for the client. Credentials are never stored.

## Configuration

Environment variables (or a `.env` file; see `.env.example`):

| Variable                                               | Default     | Purpose                                                                                                         |
| ------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                 | `8080`      | Port the server listens on.                                                                                     |
| `HOST`                                                 | `127.0.0.1` | Interface to bind. The container image sets `0.0.0.0`; `scripts/start.sh` publishes it on localhost only.       |
| `ALLOWED_TENANT_HOSTS`                                 | _(any)_     | Comma-separated tenant hosts users may sign in to; `*.example.com` allows subdomains. **Set this when shared.** |
| `SERVICES_URL`                                         | _(derived)_ | Sign-in service URL for tenants that don't use the `services.` host convention.                                 |
| `ENV_MODE`                                             | `DESIGN`    | `Env-Mode` header when the tenant doesn't report the user's default mode.                                       |
| `SESSION_TTL_MINUTES`                                  | `480`       | Idle time before a session ends.                                                                                |
| `UPSTREAM_TIMEOUT_SECONDS`                             | `30`        | Per-request timeout to the tenant.                                                                              |
| `CRAWL_CONCURRENCY`                                    | `12`        | Parallel requests to the tenant while crawling.                                                                 |
| `MAX_RESOURCES_CAP`                                    | `100000`    | Upper bound users can request for _Max resources_.                                                              |
| `LOGIN_ATTEMPTS_PER_MINUTE`                            | `10`        | Sign-in attempts allowed per client per minute.                                                                 |
| `TRUST_PROXY`                                          | `false`     | Set to `true` behind a TLS-terminating reverse proxy so the session cookie is marked `Secure`.                  |
| `ALLOWED_ORIGINS`                                      | _(none)_    | Extra browser origins allowed to call the API (same-origin always is).                                          |
| `NODE_EXTRA_CA_CERTS` / `NODE_TLS_REJECT_UNAUTHORIZED` | _(unset)_   | Standard Node settings for tenants behind an internal CA.                                                       |

Run it behind HTTPS if it is reachable by anyone but you: the sign-in form posts a password to this server.

## Development

```sh
npm run dev        # server on :8080 (restarts on change) + Vite on http://localhost:5173
npm test           # server and client unit tests (node:test)
npm run lint
npm run format
```

Layout:

- `server/` Express app: sign-in and sessions, the crawler, the REST API (below).
- `client/` React 19 + Vite app; the graph is drawn with `force-graph` (canvas, d3-force physics).
- `client/src/ds/` the Amplify Fusion design system's tokens, `ads-*` classes and Roboto, vendored unchanged.
- `scripts/` the root-resource extractor and the container start script.

### API

All under `/api`, JSON, same-origin, session cookie.

| Endpoint            | Purpose                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /session`      | Who is signed in (`{ authenticated }`).                                                                                                                   |
| `POST /login`       | `{ tenantUrl, email, password }` -> starts a session.                                                                                                     |
| `POST /logout`      | Ends the session and signs out of the tenant.                                                                                                             |
| `GET /roots`        | The root resource types.                                                                                                                                  |
| `GET /roots/counts` | Record count per root type, or why it can't be listed.                                                                                                    |
| `PUT /mode`         | `{ mode }` (`DESIGN`, `CHECK` or `LIVE`) -> the `Env-Mode` every later request uses.                                                                      |
| `POST /graph`       | `{ roots, perRoot, maxResources }` -> reads the root types (no relationships). Streams NDJSON: `progress`, `graph` batches of `{ nodes }`, then `result`. |
| `POST /expand`      | `{ tasks, known, follow, maxResources }` -> loads relationships of resources the client already has (`follow`: `one` or `all`). Same stream.              |

### Root resources

The list in `server/root-resources.json` is every `@Include` entity in the Fusion graph model that is root level
(`rootLevel` defaults to true). Regenerate it after the model changes:

```sh
npm run roots -- /path/to/graph-model/src/main/java/io/dxchange/graph/model
```
