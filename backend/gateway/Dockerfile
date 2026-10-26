FROM node

WORKDIR /app


COPY package*.json ./
# root package only holds shared runtime deps (ioredis); dev deps (vitest, mongodb-memory-server) stay out of the image
RUN npm install --omit=dev

COPY ./gateway/package*.json ./gateway/
RUN cd gateway && npm install

COPY gateway ./gateway
COPY shared ./shared

WORKDIR /app/gateway

EXPOSE 8000

CMD [ "npm","start" ]





