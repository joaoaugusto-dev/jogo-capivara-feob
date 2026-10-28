FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
ENV JOIN_URL=https://capivarias-abduzidas.joaoaugusto.dev/join
EXPOSE 3000
CMD ["node", "server/index.js"]
