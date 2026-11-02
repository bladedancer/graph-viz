# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Graph Visualizer signs in to an Amplify Fusion tenant, crawls its JSON:API config model (`/api/config/v1/...`) from user-chosen root resource types, and draws the resources and their relationships as an interactive force-directed graph. See `README.md` for usage and configuration, `PRODUCT.md` for product context.

## Commands

- `npm run dev` — server on :8080 (node `--watch`) and Vite on :5173, which proxies `/api` to the server. Open :5173.
- `npm run build` — Vite builds the client to `client/dist` (git-ignored); `npm start` serves it from Express.
- `npm test` — all unit tests (`node --test`, no extra framework). One file: `node --test server/crawler.test.js`.
- `npm run lint` / `npm run format` — ESLint 10 (flat config, react-hooks rules) / Prettier (4 spaces, single quotes, 140 cols).
- `scripts/start.sh` — builds the Docker/Podman image and runs it published on `127.0.0.1:$PORT` only.
- `npm run roots -- <graph-model dir>` — regenerates `server/root-resources.json` from the Java model's `@Include` annotations.

## Architecture

**Why a server:** the tenant's CORS policy only allows its own origins (verified live), so a browser-only app can't sign in or call the config API. The Express server (`server/`) signs in, keeps the access token in an in-memory session (`sessions.js`; the browser only has an HttpOnly SameSite=Strict `gv_sid` cookie), and does all upstream calls. Don't move tokens or tenant calls into the client.

**Server**

- `app.js` — routes, security headers, same-origin check on writes, sign-in rate limit. `POST /api/graph` streams NDJSON (`progress`, `graph` batches, final `result`/`error`); mid-stream errors are sent in-band because headers are already out. `PUT /api/mode` sets the session's `DESIGN`/`CHECK`/`LIVE` environment (`modes.js`); `configClient` snapshots the mode when it is created so a running crawl can't switch environments. `POST /api/expand` takes client-supplied paths, so `validate.js` holds them to the characters Elide paths use (no `..`, encoded slashes, query strings) and caps sizes.
- `upstream.js` — tenant URL parsing (sign-in host = first label replaced with `services`; original first label is the login `domain`; `SERVICES_URL` overrides), `login`, and `configClient` (timeouts, retries on 429/5xx).
- `crawler.js` — one engine for three jobs, selected by `follow`: `none` (roots only; what `POST /api/graph` does), `one` and `all` (what `POST /api/expand` does for relationship groups the client names). Phase 1 lists each selected root type (`page[size]` max 100, `perRoot` up to 10,000, pages requested in parallel windows; a page that keeps failing is skipped, three in a row abandon the type). Relationship expansion is deferred until every root is read, so no type's neighbours can use up the budget before the other types have their roots. A parent's to-many relationship is loaded in bulk by paging its nested collection (`/project/<id>/apiproxies?page[size]=100`) when `ceil(N/100)` is fewer requests than fetching its unclaimed children one by one; otherwise each child is fetched individually (by id first for types with their own collection, else via the parent's nested path); a failed or incomplete listing falls back to per-child. Every upstream call goes through one limiter that halves concurrency on 429/5xx and retries with backoff (500s twice, others five times). `known` ids count against `maxResources` and are never re-fetched. The user's Max resources applies only to `POST /api/graph`: `POST /api/expand` takes no limit from the client, and `app.js` sets its budget to `known.length + maxResourcesCap` so the existing graph never blocks an expansion (the cap is only a per-request backstop on new resources). Each node carries its `path` so the client can ask for expansions later. Unfetchable resources stay as `unresolved` placeholders; per-type failures are aggregated warnings; 401 aborts.
- `roots.js` + `root-resources.json` — root types and per-type record counts (`?page[size]=1&page[totals]`). Counts use `page[totals]`, which many polymorphic types (CORS Rule, Auth Rule, …) reject with a 400 even though they list fine; those fall back to a plain listing and show an unknown count (`total: null`). Only types that can't be listed at all (404/500; `basicauthrule` on the test tenant) are disabled in the UI. `envmode` is excluded outright (`EXCLUDED` in `scripts/extract-root-resources.mjs`) because the tenant answers every request for it with a 500.
- `fixtures.js` — in-memory fake tenant used by the tests.

**Client** (`client/src`, React 19, plain JSX, Vite)

- `utils/graphStore.js` — `GraphStore` holds streamed nodes with stable object identity (force-graph mutates them with positions). Links are derived from each node's `relationships` (ids it points at) as both ends arrive; an `unloaded` reverse index remembers edges whose target isn't loaded, which is also what "related not loaded" and `expansionTasks()` (the body for `/api/expand`) are computed from. Also adjacency, grouping (resources without a `projectId` take the group most neighbours are in) and the color legend. `applyFilter` implements search plus connected-resources (transitive: everything a match leads to and/or everything leading to it, walked separately so "Both" isn't the whole component); `GraphCanvas` keeps what it includes in its legend colors, dims the rest, and, with "Hide unselected", hides the rest via force-graph's `nodeVisibility`/`linkVisibility` instead of dimming it.
- `components/GraphCanvas.jsx` — wraps `force-graph` (canvas, d3-force). Gotchas: pass **copies** of the store's arrays to `graphData` (the live arrays contain unresolved links between renders and crash the link force); to repaint a settled graph, re-set accessors with fresh closures; draw callbacks read `latest` refs, not props.
- `components/Explorer.jsx` — owns load/cancel, a queue of relationship loads (double-click = `follow: 'one'`, shift+double-click and the Load relationships buttons = `'all'`; because the server never re-fetches `known` ids, an `'all'` load starts from everything already reachable (`GraphStore.reachable`) and repeats while it finds more), selection, filter, physics and layout state, and the environment switch (cancel everything, `PUT /api/mode`, refetch counts for the new mode, reload the graph if there was one). `GraphCanvas` detects double-clicks itself (350 ms, shift read from the second click); right-click unpins. `ControlsPanel` (Source/Filter/Layout/Colors), `DetailsPanel`, `RootSelect` are the pieces.
- `ds/` — the Amplify Fusion design system vendored from its design-system artifact (tokens, `ads-*` classes, Roboto). Don't edit it; style with its `--ads-*` tokens, never raw hex. Light theme only. `app.css` holds layout and app-specific components.
- `api.js` — fetch wrapper; `loadGraph` reads the NDJSON stream.

## Things to know

- The tenant is large (thousands of resources per type), which is why crawls are bounded and why counts are shown in the picker. Limits go up to 10,000 per type / 100,000 total; for big graphs `Explorer` publishes store updates at most every 3 s and `GraphCanvas` skips the layout warm-up (>2,000 nodes) and arrowheads and node outlines while zoomed out (>5,000 nodes).
- ESLint's react-hooks rules forbid `setState` inside effects; adjust state during render or derive it instead.
- Deployment is a container (`Dockerfile`); GitHub Pages is no longer possible because of the server.
