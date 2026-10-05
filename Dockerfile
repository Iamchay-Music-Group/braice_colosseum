# syntax=docker/dockerfile:1.7
#
# Production image for the BRAICE NestJS API.
#
# Two facts about this repository determine the shape of this file:
#
#   1. It is a pnpm workspace. `pnpm-workspace.yaml` contains apps/*,
#      packages/* and programs/*, and apps/api resolves @braice/permission-engine,
#      @braice/blockchain-client and @braice/ai-client as `workspace:*`. The
#      build context is therefore the REPOSITORY ROOT, not apps/api: built from
#      apps/api there would be no lockfile, no workspace siblings and no way to
#      satisfy those three dependencies.
#
#   2. The three libraries are consumed through their compiled `main`
#      (dist/index.js), not their TypeScript sources. They have to be compiled
#      before apps/api is compiled, which is exactly the order the root
#      `pnpm build` script already encodes.
#
# Nothing about the application is configured here. The image contains no
# credentials: DATABASE_URL, JWT_SECRET, SOLANA_*, AI_* and FRONTEND_URL are
# read from the process environment at boot and are expected to be injected by
# the ECS task definition (Secrets Manager / SSM parameter references).

# ─────────────────────────────────────────────────────────────────────────────
# base: Node plus the pnpm this repository pins
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS base

# Matches the Node version the `build` CI job runs under, so a build that
# passes in CI and a build that reaches ECR are the same build.
#
# bookworm-slim rather than alpine: glibc matches the runner and the host, and
# nothing here needs musl, but a musl-only native module added later would
# fail at runtime in a way CI could never have caught.
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# corepack ships with the node image and reads `packageManager` from the root
# package.json, so this resolves the pnpm version the repository pins instead
# of whatever corepack considers newest.
RUN corepack enable

# Move the content-addressable store out of $HOME so a BuildKit cache mount can
# own it. Reused across builds, it turns a ~600 MB download per CI run into a
# layer that is only rebuilt when a dependency actually changes.
RUN pnpm config set store-dir /pnpm/store

WORKDIR /workspace

# ─────────────────────────────────────────────────────────────────────────────
# deps: resolve the whole workspace from the lockfile
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Manifests only, so this layer survives every source edit and is invalidated
# only by a dependency change. Every workspace member's package.json is
# required: pnpm matches the lockfile's importers against the members it can
# see, and a missing member makes --frozen-lockfile fail with ERR_PNPM_OUTDATED_LOCKFILE.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/ai-client/package.json packages/ai-client/package.json
COPY packages/blockchain-client/package.json packages/blockchain-client/package.json
COPY packages/governance-engine/package.json packages/governance-engine/package.json
COPY packages/permission-engine/package.json packages/permission-engine/package.json
COPY packages/types/package.json packages/types/package.json
COPY programs/braice-governance/package.json programs/braice-governance/package.json

RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# build: compile the workspace, then cut a self-contained production bundle
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS build

# Everything else. node_modules, dist and .env* are in .dockerignore, so this
# layers on top of the install above instead of replacing it.
COPY . .

# Root script, in dependency order: permission-engine, blockchain-client,
# ai-client, then @braice/api (`nest build` -> apps/api/dist).
RUN pnpm build

# `pnpm deploy` resolves apps/api's `workspace:*` dependencies into real
# directories inside the output and installs production dependencies only, so
# the runtime stage needs neither the pnpm workspace nor devDependencies.
#
# --legacy is required: from pnpm 10 onward the non-legacy implementation only
# works when the workspace sets `inject-workspace-packages=true`, which this
# workspace deliberately does not (injection would copy the libraries instead
# of symlinking them, changing how `pnpm dev` behaves for everyone).
RUN pnpm --filter @braice/api deploy --prod --legacy /prod/api

# The deployed bundle is a package, not a source tree: keep what runs, drop
# what cannot. `*.spec.js` is compiled jest output that nothing imports, and
# the source maps would otherwise publish the original TypeScript.
RUN find /prod/api/dist \( -name '*.map' -o -name '*.spec.js' -o -name '*.spec.d.ts' \) -delete \
 && rm -rf \
      /prod/api/src \
      /prod/api/test \
      /prod/api/jest.config.js \
      /prod/api/.eslintrc.js \
      /prod/api/nest-cli.json \
      /prod/api/tsconfig.json

# ─────────────────────────────────────────────────────────────────────────────
# runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
# ECS Fargate overrides PORT from the task definition. 3001 is the value
# apps/api/src/main.ts already defaults to, so the image is runnable as-is.
ENV PORT=3001

WORKDIR /app

COPY --from=build --chown=node:node /prod/api ./

# `node dist/scripts/migrate.js` resolves its SQL with
# join(__dirname, '../../../../database/migrations'), i.e. four levels above
# dist/scripts — the same relative position it occupies at
# apps/api/dist/scripts in the repository. From /app/dist/scripts that path is
# `/`, so the migrations are placed there rather than rewriting the script.
# Applying them stays an explicit operator action
# (`aws ecs run-task --command "node dist/scripts/migrate.js"`); they are
# deliberately not run at container start.
COPY --from=build --chown=node:node /workspace/database/migrations /database/migrations

# The node user ships with the base image (uid 1000). Nothing in the app
# writes to its own directory, so it never needs root.
USER node

EXPOSE 3001

# Liveness only. /api/health answers 200 while Postgres is down and reports
# `status: "degraded"` in the body, which is deliberate: a database blip should
# not have Fargate restarting a healthy process. That is a deployment signal,
# not a container failure.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# dist/main.js is `nest build` output for apps/api/src/main.ts. The form is
# exec-style so PID 1 is node itself and ECS stop signals are delivered to it.
CMD ["node", "dist/main.js"]