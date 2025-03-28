FROM node:18 AS builderenv

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    optipng \
    ffmpeg \
    curl \
    bzip2

# Download and install precompiled KTX-Software
RUN curl -L https://github.com/KhronosGroup/KTX-Software/releases/download/v4.3.2/KTX-Software-4.3.2-Linux-x86_64.tar.bz2 -o /tmp/ktx.tar.bz2 && \
    tar xf /tmp/ktx.tar.bz2 -C /tmp && \
    cp /tmp/KTX-Software-4.3.2-Linux-x86_64/bin/toktx /usr/local/bin/ && \
    cp /tmp/KTX-Software-4.3.2-Linux-x86_64/bin/ktx2ktx2 /usr/local/bin/ && \
    cp /tmp/KTX-Software-4.3.2-Linux-x86_64/lib/libktx.so* /usr/local/lib/ && \
    rm -rf /tmp/KTX-Software*

COPY package*.json /app/
RUN npm install

COPY . /app
RUN npm run build
RUN npm ci --only=production

FROM node:18

RUN apt-get update && apt-get install -y \
    optipng \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy the static binaries and libraries
COPY --from=builderenv /usr/local/bin/ktx2ktx2 /usr/local/bin/ktx2ktx2
COPY --from=builderenv /usr/local/bin/toktx /usr/local/bin/toktx
COPY --from=builderenv /usr/local/lib/libktx.so* /usr/local/lib/

WORKDIR /app

COPY --from=builderenv /app/dist /app/dist
COPY --from=builderenv /app/node_modules /app/node_modules

ENV NODE_ENV=production
ENV PORT=8000
ENV PATH="/usr/local/bin:${PATH}"
ENV LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}"

EXPOSE 8000

CMD ["node", "dist/index.js"]
