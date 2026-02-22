FROM node:20-slim

# gh CLI インストール
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && \
    apt-get install -y gh && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 非rootユーザー
RUN groupadd -r sandbox && useradd -r -g sandbox -m sandbox

WORKDIR /workspace

# claude CLI（ホストからマウントまたは事前インストール）
# npm install -g @anthropic-ai/claude-code は容量が大きいため、
# ホストの claude CLI をバインドマウントすることを推奨

USER sandbox

CMD ["bash"]
