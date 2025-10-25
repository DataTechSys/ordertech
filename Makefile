SHELL := /bin/bash

.PHONY: help preflight gcloud-config deploy logs describe local-https local-up local-down local-install-agent local-uninstall-agent

help:
	@echo "Targets:"
	@echo "  make gcloud-config         - Create/activate named gcloud config and enable required APIs"
	@echo "  make preflight             - Validate gcloud environment matches production config"
	@echo "  make deploy                - Build from source and deploy to Cloud Run (production)"
	@echo "  make logs                  - Tail recent logs"
	@echo "  make describe              - Show service details"
	@echo "  make local-https           - Install mkcert, configure nginx, and add hosts entries (idempotent)"
	@echo "  make local-up              - Start local Cloud SQL proxy and server (background)"
	@echo "  make local-down            - Stop local Cloud SQL proxy and server"
	@echo "  make local-install-agent   - Auto-start proxy+server at login (LaunchAgent)"
	@echo "  make local-uninstall-agent - Remove the LaunchAgent"
	@echo "  make publish-tenants-ui    - Upload Tenants UI to GCS (gs://$$ASSETS_BUCKET/tenants)"

preflight:
	./scripts/preflight.sh

gcloud-config:
	./scripts/setup_gcloud_config.sh

deploy:
	./scripts/deploy.sh

logs:
	. ./config/prod.env && gcloud run logs read $$SERVICE_NAME --project $$PROJECT_ID --region $$REGION --limit 100

describe:
	. ./config/prod.env && gcloud run services describe $$SERVICE_NAME --project $$PROJECT_ID --region $$REGION

local-https:
	bash ./scripts/setup_local_https.sh

local-up:
	. ./scripts/local_up.sh

local-down:
	. ./scripts/local_down.sh

local-install-agent:
	mkdir -p $$HOME/Library/LaunchAgents
	cp -f ./scripts/launchd/com.ordertech.localdev.plist $$HOME/Library/LaunchAgents/com.ordertech.localdev.plist
	launchctl unload $$HOME/Library/LaunchAgents/com.ordertech.localdev.plist >/dev/null 2>&1 || true
	launchctl load $$HOME/Library/LaunchAgents/com.ordertech.localdev.plist
	launchctl list | grep -i com.ordertech.localdev || true
	@echo "Installed LaunchAgent. It will run at login."

local-uninstall-agent:
	launchctl unload $$HOME/Library/LaunchAgents/com.ordertech.localdev.plist >/dev/null 2>&1 || true
	rm -f $$HOME/Library/LaunchAgents/com.ordertech.localdev.plist
	@echo "Removed LaunchAgent."

publish-tenants-ui:
	./scripts/publish_tenants_ui.sh tenants
