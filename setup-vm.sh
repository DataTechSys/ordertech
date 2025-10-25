#!/bin/bash
set -euo pipefail

# LiveKit VM setup script
echo "🚀 Setting up LiveKit VM..."

# Update system
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg

# Install Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release; echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

# Enable Docker to start on boot
sudo systemctl enable docker

# Create deployment directory
mkdir -p ~/livekit && cd ~/livekit

# Create directories for Caddy
mkdir -p caddy_data caddy_config

# Set API keys from environment
LIVEKIT_API_KEY=${1:-"9ef3e7acad90d879714acd08"}
LIVEKIT_API_SECRET=${2:-"BOGUWDnsFSWxsJsrmMVfItNVqLRRFElfnWwzO6THkZ8="}

echo "📝 Creating LiveKit configuration..."

# Create livekit.yaml
cat > ~/livekit/livekit.yaml << EOF
server:
  # Public DNS name clients will use
  http_listen_address: 0.0.0.0
  http_port: 7880
  ws_listen_address: 0.0.0.0
  ws_port: 7881
  prometheus_port: 6789
  # External address advertised to participants
  external_dns: rtc.ordertech.me

rtc:
  # UDP media ports
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

# API keys for token verification
keys:
  $LIVEKIT_API_KEY: $LIVEKIT_API_SECRET

logging:
  level: info
EOF

# Create Caddyfile
cat > ~/livekit/Caddyfile << 'EOF'
rtc.ordertech.me {
  encode zstd gzip
  reverse_proxy 127.0.0.1:7881
}
EOF

# Create docker-compose.yml
cat > ~/livekit/docker-compose.yml << 'EOF'
services:
  livekit:
    image: livekit/livekit-server:latest
    command: ["--config", "/etc/livekit/livekit.yaml"]
    volumes:
      - ./livekit.yaml:/etc/livekit/livekit.yaml:ro
    network_mode: host
    restart: unless-stopped
    ulimits:
      nofile:
        soft: 1048576
        hard: 1048576

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy_data:/data
      - ./caddy_config:/config
EOF

echo "✅ Configuration files created!"
echo "📋 Next: Set up DNS for rtc.ordertech.me -> 34.18.149.201"
echo "🔧 To start services: cd ~/livekit && docker compose pull && docker compose up -d"
echo "📊 Generated keys:"
echo "  LIVEKIT_API_KEY=$LIVEKIT_API_KEY"
echo "  LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET"