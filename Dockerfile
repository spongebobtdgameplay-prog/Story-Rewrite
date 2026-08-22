FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip build-essential cmake libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS" python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY . .
RUN python3 storybot_ai.py --download-only

ENV NODE_ENV=production
ENV STORYBOT_THREADS=1
ENV STORYBOT_CONTEXT_SIZE=1536

CMD ["npm", "start"]
