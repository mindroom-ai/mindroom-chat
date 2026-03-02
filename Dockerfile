## Builder
FROM node:20.12.2-alpine3.18 as builder

WORKDIR /src

COPY .npmrc package.json package-lock.json /src/
RUN npm ci
COPY . /src/
ENV NODE_OPTIONS=--max_old_space_size=4096
ARG APP_BUILD_BASE_PATH
ENV APP_BUILD_BASE_PATH=${APP_BUILD_BASE_PATH}
RUN npm run build


## App
FROM nginx:1.29.3-alpine

COPY --from=builder /src/dist /app
COPY --from=builder /src/docker-nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/99-runtime-config.sh /docker-entrypoint.d/99-runtime-config.sh

RUN rm -rf /usr/share/nginx/html \
  && ln -s /app /usr/share/nginx/html
