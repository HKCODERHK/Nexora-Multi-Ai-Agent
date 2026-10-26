FROM node

WORKDIR /app


COPY package*.json ./
# root package only holds shared runtime deps (ioredis); dev deps (vitest, mongodb-memory-server) stay out of the image
RUN npm install --omit=dev

COPY ./services/auth/package*.json ./services/auth/
RUN cd services/auth && npm install

COPY services/auth ./services/auth
COPY shared ./shared

WORKDIR /app/services/auth

EXPOSE 8001

CMD [ "npm","start" ]
