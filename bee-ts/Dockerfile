# syntax=docker/dockerfile:1.7
# bee-ts MCP server wrapped with supergateway for streamable HTTP.
FROM supercorp/supergateway:3.4.3-uvx

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
COPY bee-ca.pem ./bee-ca.pem

ENV BEE_CA_PATH=/app/bee-ca.pem

EXPOSE 8000

ENTRYPOINT ["supergateway"]
CMD ["--stdio", "npx tsx /app/src/server.ts", \
     "--outputTransport", "streamableHttp", \
     "--port", "8000", \
     "--cwd", "/app"]
