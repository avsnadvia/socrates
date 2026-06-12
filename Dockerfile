FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV TZ=America/Sao_Paulo
EXPOSE 3000
CMD ["node", "src/index.js"]
