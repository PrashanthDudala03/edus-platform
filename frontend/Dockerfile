FROM node:24-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=/api/v1
ARG APP_VERSION=1.0.0-rc.1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN VITE_API_URL=${VITE_API_URL} npm run build

FROM node:24-alpine
WORKDIR /app
ARG APP_VERSION=1.0.0-rc.1

RUN npm install --global serve@14.2.4 --no-audit --no-fund

COPY --from=builder /app/dist ./dist
LABEL org.opencontainers.image.title="EduOS" \
      org.opencontainers.image.version=${APP_VERSION}

ENV HOST=0.0.0.0
ENV PORT=3000
USER node

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["serve", "-s", "dist", "-l", "3000"]
