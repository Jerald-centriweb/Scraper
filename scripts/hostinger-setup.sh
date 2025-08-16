#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Hostinger VPS setup: Docker, Compose, jq, and psql (PostgreSQL client)"

# Update package lists
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release jq postgresql-client git
  # Docker Engine
  if ! command -v docker >/dev/null 2>&1; then
    echo "📦 Installing Docker Engine..."
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # Add current user to docker group
  sudo usermod -aG docker "$USER" || true
else
  echo "This script currently supports Debian/Ubuntu-based systems via apt-get."
  echo "If you are on a different distro, install Docker, docker-compose-plugin, jq, and psql manually."
fi

echo "✅ Setup complete. Log out and back in (or run 'newgrp docker') before using Docker without sudo."