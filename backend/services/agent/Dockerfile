FROM node

WORKDIR /app


COPY package*.json ./
# root package only holds shared runtime deps (ioredis); dev deps (vitest, mongodb-memory-server) stay out of the image
RUN npm install --omit=dev

COPY ./services/agent/package*.json ./services/agent/
RUN cd services/agent && npm install

COPY services/agent ./services/agent
COPY shared ./shared

WORKDIR /app/services/agent

EXPOSE 8003

CMD [ "npm","start" ]
