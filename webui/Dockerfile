ARG BASE_IMAGE=heybox-daily-login:latest
FROM ${BASE_IMAGE}

WORKDIR /app
COPY . /app/webui/

ENV TZ=Asia/Shanghai NODE_ENV=production PORT=8620
EXPOSE 8620

ENTRYPOINT ["node", "webui/server.js"]
