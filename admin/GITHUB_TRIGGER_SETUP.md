# GitHub Cloud Build Trigger Setup

## Current Status
The admin-ordertech-me service is deployed and working. To enable automatic deployment when you push changes to the `admin/` directory, you need to set up a Cloud Build trigger.

## Prerequisites
The GitHub app must be connected to your GCP project first.

## Setup Steps

### Option 1: Via GCP Console (Recommended)

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers?project=smart-order-469705)

2. Click **"Connect Repository"** if you haven't connected DataTechSys/ordertech yet
   - Choose **GitHub (Cloud Build GitHub App)**
   - Authenticate with GitHub
   - Select **DataTechSys/ordertech** repository

3. Click **"Create Trigger"**

4. Configure the trigger:
   ```
   Name: admin-ordertech-me-deploy
   Description: Deploy admin-ordertech-me when admin/ changes
   
   Event: Push to a branch
   Source:
     Repository: DataTechSys/ordertech
     Branch: ^main$
   
   Configuration:
     Type: Cloud Build configuration file
     Location: admin/cloudbuild.yaml
   
   Filters:
     Included files filter (glob): admin/**
   
   Advanced (substitution variables):
     _IMAGE_TAG: ${SHORT_SHA}
   ```

5. Click **"Create"**

### Option 2: Via gcloud CLI (After GitHub App is Connected)

Once the GitHub app is connected, you can create the trigger:

```bash
gcloud builds triggers create github \
  --name="admin-ordertech-me-deploy" \
  --repo-name="ordertech" \
  --repo-owner="DataTechSys" \
  --branch-pattern="^main$" \
  --build-config="admin/cloudbuild.yaml" \
  --included-files="admin/**" \
  --description="Deploy admin-ordertech-me when admin/ changes"
```

Or using the trigger config file:

```bash
gcloud builds triggers import --source=admin/trigger-config.yaml
```

## Manual Deployment

Until the trigger is set up, you can deploy manually:

```bash
cd /Volumes/MOSAWI-T9/DATATECH/OrderTech
gcloud builds submit --config=admin/cloudbuild.yaml --substitutions=_IMAGE_TAG=v$(date +%s)
```

## Verification

After setting up the trigger:

1. Make a small change to any file in `admin/`
2. Commit and push to main branch
3. Go to [Cloud Build History](https://console.cloud.google.com/cloud-build/builds?project=smart-order-469705)
4. You should see a build triggered automatically
5. Once complete, verify at https://admin.ordertech.me

## Trigger Configuration File

The trigger configuration is saved in `admin/trigger-config.yaml` for reference.
