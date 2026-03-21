FROM node:20-slim AS base
WORKDIR /app

# Install OCR tools for scanned PDF ingestion
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-vie \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production
COPY src ./src
COPY scripts ./scripts
CMD ["node", "src/index.js"]
