FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# 用 nginx 托管 dist + examples
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html/dist
COPY --from=builder /app/examples /usr/share/nginx/html/examples
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
