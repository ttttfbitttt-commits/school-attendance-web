FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-ara
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
USER node
EXPOSE 3000
CMD ["npm", "start"]
