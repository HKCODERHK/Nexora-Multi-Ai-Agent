FROM node

WORKDIR /app


COPY package*.json ./
# root package only holds shared runtime deps (ioredis); dev deps (vitest, mongodb-memory-server) stay out of the image
RUN npm install --omit=dev

COPY ./services/chat/package*.json ./services/chat/
RUN cd services/chat && npm install

COPY services/chat ./services/chat
COPY shared ./shared

WORKDIR /app/services/chat

EXPOSE 8002

CMD [ "npm","start" ]
