FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173
CMD ["npm", "start"]
