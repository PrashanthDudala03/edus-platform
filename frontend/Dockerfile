FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_URL=http://localhost:6001/api

COPY package*.json ./
RUN npm install

COPY . .
RUN VITE_API_URL=${VITE_API_URL} npm run build

FROM node:20-alpine
WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["serve", "-s", "dist", "-l", "3000"]
