# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Built: Vite + React 19 client, Express 5 server, `force-graph` (d3-force physics, canvas) for the graph. Browser-only is not possible: the Fusion tenant's CORS policy only allows its own origins, so the Node server performs sign-in and all upstream calls and exposes a REST API to the client. Deployed as a container (`Dockerfile`); `scripts/start.sh` runs it published on localhost only. GitHub Pages is no longer a deploy target.

## Users

Primarily people giving demos and presentations of the Axway Amplify Fusion platform (internal), screen-sharing a live tenant's resource graph. Secondary: engineers exploring how Fusion config resources relate.

## Product Purpose

Graph Visualizer signs in to a Fusion tenant, crawls its JSONAPI config model (`/api/config/v1/<root>`, following `relationships`) and shows the resources and their relationships as an interactive, physics-driven graph. Success: someone can sign in, pick a root, and within seconds have a graph they can drag, search, focus on and explain to an audience.

## Positioning

It renders a customer's real, live Fusion configuration (projects, API proxies, endpoints, rules, activations) as a connected, explorable graph rather than lists of JSON, by following the JSONAPI relationship links.

## Operating Context

- Upstream: Fusion tenant at `https://<tenant>.<domain>`; login at `https://services.<domain>/api/auth/login` (first host label replaced by `services`, the original first label sent as `domain`); config API at `<tenantUrl>/api/config/v1/...` with `Authorization: Bearer` and `Env-Mode` (DESIGN by default) headers.
- Verified 2026-11-02 against a test tenant: login and config calls succeed from a server; browsers on other origins receive no `Access-Control-Allow-Origin`.
- Internal use, often screen-shared; graph size is unknown (design for hundreds of nodes, degrade gracefully for thousands).

## Capabilities and Constraints

- Sign in with tenant URL, email and password; token stays server-side.
- Choose one or more root resource types from the root-level entities of the Fusion graph model (a multi-select with per-type counts) and read them, bounded by resources per type (up to 10,000) and max resources (up to 100,000), with progress while the graph grows.
- Relationships are loaded on demand: a Load relationships button for everything loaded, double-click for one resource one level deep, shift + double-click for everything reachable from it.
- Switch the tenant environment (Design, Check, Live) from the header; the choice is sent as the `Env-Mode` header and reloads the graph.
- Interactive physics layout: drag, pin, zoom/pan, tune forces, pause/resume.
- Filter/search by label, show connected nodes (inbound/outbound/both), select nodes and see their details.
- Export the graph as an image.
- Entity grouping and root-type lists are specific to the Fusion config model (project, application, idp, onpremdataplane, apiproxy, …).
- The tenant is large (thousands of resources per root type); crawls are bounded by design.
- Undecided: cloud deploy platform, session persistence across server restarts, multi-user hardening.

## Brand Commitments

Existing name: "Graph Visualizer". No logo or brand assets exist in the repo.

The UI is built in the user's Amplify Fusion design system (Amplify Studio look: Roboto, teal `--ads-primary-500`, 5px radius, 32px controls, `ads-*` classes, light theme only), vendored in `client/src/ds/`. This is binding: style with its tokens, not raw values. The approved look was mocked up in a Design canvas before the build.

## Evidence on Hand

A reachable test tenant (provided by the user for testing; credentials are not stored in the repo). No screenshots, testimonials or customer data exist and none may be invented.

## Product Principles

- The graph is the product; chrome recedes and never covers it.
- Everything shown comes from the live tenant; nothing is simulated.
- Demo-ready by default: it should look right on a projector and survive being driven live in front of people.
- Credentials never touch client storage or the repo.
