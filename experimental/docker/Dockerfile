# EXPERIMENTAL AND UNTESTED.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV BS_HOST=0.0.0.0 BS_DATA_DIR=/data
VOLUME /data
ENTRYPOINT ["node"]
