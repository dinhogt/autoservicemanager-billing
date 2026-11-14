FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM dependencies AS builder
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts --prefer-offline

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S billing && adduser -S -G billing -u 10001 billing
COPY --from=production-dependencies --chown=billing:billing /app/node_modules ./node_modules
COPY --from=builder --chown=billing:billing /app/dist ./dist
COPY --from=builder --chown=billing:billing /app/package.json ./
USER 10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
