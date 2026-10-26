FROM node

WORKDIR /app


COPY package*.json ./
# root package only holds shared runtime deps (ioredis); dev deps (vitest, mongodb-memory-server) stay out of the image
RUN npm install --omit=dev

COPY ./services/billing/package*.json ./services/billing/
RUN cd services/billing && npm install

COPY services/billing ./services/billing
COPY shared ./shared

WORKDIR /app/services/billing

EXPOSE 8004

CMD [ "npm","start" ]
