FROM --platform=linux/amd64 node AS builder
WORKDIR /app
COPY ./package.json ./
RUN npm install
COPY . .
RUN npm run build


FROM --platform=linux/amd64 node
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 80
ENV NODE_ENV qa
CMD ["node", "dist/main.js"]