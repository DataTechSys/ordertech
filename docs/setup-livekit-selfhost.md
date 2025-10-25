# Self-hosted LiveKit Setup for OrderTech (me-central1)

This document describes the complete setup for self-hosting LiveKit on Google Compute Engine in the me-central1 region.

## Architecture Overview

- **Compute Engine VM**: `livekit-1` (e2-standard-4, Ubuntu 22.04 LTS)
- **Static IP**: `34.18.149.201` (reserved as `livekit-ip`)
- **Domain**: `rtc.ordertech.me` (requires DNS A record)
- **Reverse Proxy**: Caddy (automatic TLS with Let's Encrypt)
- **LiveKit Server**: Docker container (network_mode: host)
- **Firewall**: TCP 80/443, UDP 50000-60000

## Prerequisites

1. **DNS Setup**: Create an A record for `rtc.ordertech.me` pointing to `34.18.149.201`
2. **Google Cloud CLI**: Authenticated with appropriate permissions
3. **Project**: `smart-order-469705` with Compute Engine and Secret Manager APIs enabled

## Infrastructure Setup

### 1. Reserve Static IP
```bash
gcloud compute addresses create livekit-ip --region=me-central1 --project smart-order-469705
```

### 2. Create Firewall Rules
```bash
# Allow TLS/HTTP for Caddy
gcloud compute firewall-rules create livekit-allow-web \
  --network=default --direction=INGRESS --priority=1000 \
  --action=ALLOW --rules=tcp:80,tcp:443 --target-tags=livekit \
  --source-ranges=0.0.0.0/0 --project smart-order-469705

# Allow WebRTC media
gcloud compute firewall-rules create livekit-allow-media \
  --network=default --direction=INGRESS --priority=1000 \
  --action=ALLOW --rules=udp:50000-60000 --target-tags=livekit \
  --source-ranges=0.0.0.0/0 --project smart-order-469705
```

### 3. Create VM
```bash
gcloud compute instances create livekit-1 \
  --zone=me-central1-a \
  --machine-type=e2-standard-4 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --address=livekit-ip \
  --tags=livekit \
  --boot-disk-size=50GB \
  --project smart-order-469705
```

## VM Configuration

### 1. Install Docker and Dependencies
```bash
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705

# On the VM:
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release; echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
sudo systemctl enable docker

mkdir -p ~/livekit && cd ~/livekit
mkdir -p caddy_data caddy_config
```

### 2. Generate API Keys
```bash
# Run locally or on VM:
export LIVEKIT_API_KEY=$(openssl rand -hex 12)
export LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -d '\n')
echo "LIVEKIT_API_KEY=$LIVEKIT_API_KEY"
echo "LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET"
```

### 3. Create Configuration Files

#### `~/livekit/livekit.yaml`
```yaml
port: 7880
bind_addresses:
  - ""

rtc:
  tcp_port: 7881
  port_range_start: 50000 
  port_range_end: 60000
  use_external_ip: true

redis: {}

keys:
  [API_KEY]: [API_SECRET]

log_level: info
```

#### `~/livekit/Caddyfile`
```
rtc.ordertech.me {
  encode zstd gzip
  reverse_proxy 127.0.0.1:7881
}
```

#### `~/livekit/docker-compose.yml`
```yaml
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
```

### 4. Start Services
```bash
cd ~/livekit
docker compose pull
docker compose up -d
docker ps
```

## Cloud Run Integration

### 1. Store Secrets in Google Secret Manager
```bash
export PROJECT_ID=smart-order-469705
export LIVEKIT_WS_URL=wss://rtc.ordertech.me

# Create secrets (use actual values from VM setup)
echo -n "$LIVEKIT_API_KEY" | gcloud secrets create livekit-api-key --data-file=- --project "$PROJECT_ID"
echo -n "$LIVEKIT_API_SECRET" | gcloud secrets create livekit-api-secret --data-file=- --project "$PROJECT_ID"
echo -n "$LIVEKIT_WS_URL" | gcloud secrets create livekit-ws-url --data-file=- --project "$PROJECT_ID"
```

### 2. Update Cloud Run Service
```bash
export SERVICE=ordertech
export REGION=me-central1

gcloud run services update "$SERVICE" \
  --region="$REGION" --project="$PROJECT_ID" \
  --update-secrets="LIVEKIT_API_KEY=livekit-api-key:latest,LIVEKIT_API_SECRET=livekit-api-secret:latest,LIVEKIT_WS_URL=livekit-ws-url:latest" \
  --set-env-vars="RTC_FALLBACK_ORDER=livekit,GCP_SECRETS_ENABLE=1"
```

## Testing

### 1. Verify Infrastructure
```bash
# DNS resolution (after DNS record is set)
dig +short rtc.ordertech.me

# TLS certificate (after DNS propagation)
curl -I https://rtc.ordertech.me
```

### 2. Test Cloud Run Integration
```bash
# Config endpoint
curl -s https://app.ordertech.me/webrtc/config | jq '.sfu'

# Status endpoint
curl -s https://app.ordertech.me/admin/rtc/status | jq '.providers'

# Token generation
curl -s -X POST https://app.ordertech.me/rtc/token \
  -H 'Content-Type: application/json' \
  -d '{"provider":"livekit","basketId":"test-room-1","role":"cashier"}' | jq
```

## Monitoring & Maintenance

### Logs
```bash
# LiveKit server logs
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="docker logs -f livekit-livekit-1"

# Caddy logs
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="docker logs -f livekit-caddy-1"

# Cloud Run logs
gcloud run logs tail ordertech --region=me-central1
```

### Service Management
```bash
# Restart services
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="cd ~/livekit && docker compose restart"

# Update LiveKit
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="cd ~/livekit && docker compose pull && docker compose up -d"
```

### Security Hardening
```bash
# Enable automatic updates
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades"

# Verify firewall (only these ports should be open)
gcloud compute firewall-rules list --filter="targetTags:livekit"
```

## Scaling Considerations

### Single Node Scaling
- Upgrade VM to higher CPU/memory (e2-standard-8, c3-standard-8)
- Monitor resource usage: `docker stats`

### Multi-Node Scaling (Future)
- Use Managed Instance Groups with L4 TCP/UDP Load Balancers
- Each node needs unique external_dns or hairpin policy
- Consider GKE deployment with proper LoadBalancer services

## Troubleshooting

### Common Issues
1. **Certificate failure**: Ensure DNS A record is properly configured
2. **Connection timeout**: Check firewall rules and VM network tags
3. **Audio/Video issues**: Verify UDP port range 50000-60000 is accessible
4. **Token validation**: Confirm API keys match between VM and Secret Manager

### Debug Commands
```bash
# Check service status
docker ps
docker logs livekit-livekit-1 --tail=100
docker logs livekit-caddy-1 --tail=100

# Test local connectivity
curl -I http://localhost:7880  # LiveKit HTTP
curl -I http://localhost:7881  # LiveKit WebSocket
curl -I http://localhost:80    # Caddy HTTP

# Check certificates
openssl s_client -connect rtc.ordertech.me:443 -servername rtc.ordertech.me
```

## Cost Optimization

### Current Setup Costs (approximate)
- **e2-standard-4 VM**: ~$60/month (730 hours)
- **Static IP**: $3.65/month (in use)
- **Egress Traffic**: Variable (typically $0.12/GB to internet)

### Optimization Options
- Use preemptible instances for development (~60% savings)
- Scale down to e2-standard-2 if CPU usage is low
- Consider regional persistent disks for better performance

## Backup & Recovery

### Configuration Backup
```bash
# Backup VM configuration
gcloud compute ssh livekit-1 --zone=me-central1-a --project smart-order-469705 \
  --command="cd ~/livekit && tar -czf ~/livekit-backup-$(date +%Y%m%d).tar.gz ."

# Download backup
gcloud compute scp livekit-1:~/livekit-backup-*.tar.gz . --zone=me-central1-a --project smart-order-469705
```

### Disaster Recovery
1. Recreate VM with same configuration
2. Restore configuration files from backup
3. Update DNS if IP changes
4. Restart services

## Support Contacts

- **LiveKit Community**: https://livekit.io/community
- **LiveKit Docs**: https://docs.livekit.io/
- **Google Cloud Support**: Through Cloud Console