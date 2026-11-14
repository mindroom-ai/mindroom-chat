# syntax=docker/dockerfile:1
# The web client behind nginx, as ghcr.io/mindroom-ai/mindroom-chat publishes it for every release
# (.github/workflows/image.yml, docs/deployment.md "Container image").
#
# The app is built once, on the platform of the machine that builds the image: its output is the
# same for every platform. Each target platform's nginx image then only receives the files.

FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY patches patches
RUN npm ci
COPY . .
# The version the build reports (scripts/build-version.mjs). .git stays out of the build context,
# so without them the build names itself after its sources and `v` plus the package version.
ARG MINDROOM_BUILD_VERSION=""
ARG MINDROOM_RELEASE_VERSION=""
# Client plugins to build in (docs/configuration.md "Build-time variables"): directories in this
# stage, such as /src/plugins/example for a plugin the build context holds at plugins/example.
ARG MINDROOM_CLIENT_PLUGINS=""
RUN MINDROOM_BUILD_VERSION="$MINDROOM_BUILD_VERSION" \
    MINDROOM_RELEASE_VERSION="$MINDROOM_RELEASE_VERSION" \
    MINDROOM_CLIENT_PLUGINS="$MINDROOM_CLIENT_PLUGINS" \
    npx vite build

FROM nginx:1.30-alpine
LABEL org.opencontainers.image.title="MindRoom Chat" \
      org.opencontainers.image.description="The MindRoom web client, served by nginx" \
      org.opencontainers.image.source="https://github.com/mindroom-ai/mindroom-chat" \
      org.opencontainers.image.licenses="Apache-2.0"
# The app lives in /app and /usr/share/nginx/html points there, so a deployment's config.json
# reaches the app at either path: `mindroom local-stack` mounts it at /app/config.json, the
# MindRoom Helm chart (cluster/k8s/client) at /usr/share/nginx/html/config.json, where the
# chart's nginx config reads it. The chart's nginx serves the notices from /opt/mindroom/notices.
COPY --from=build /src/dist /app
RUN rm -rf /usr/share/nginx/html \
    && ln -s /app /usr/share/nginx/html \
    && mkdir -p /opt/mindroom/notices \
    && cp /app/runtime-config.js /opt/mindroom/runtime-config.js \
    && cp /app/notices.json /opt/mindroom/notices/notices.json
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 docker-entrypoint.d/ /docker-entrypoint.d/
