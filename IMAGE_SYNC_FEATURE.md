# Image Sync Feature - Foodics to Google Cloud Storage

## Overview
Enhanced the existing Foodics sync functionality to copy images from Foodics API to your Google Cloud Storage bucket. When you click "Sync" with the "With Images" option, images will be downloaded from Foodics and stored permanently in your cloud storage.

## What Was Implemented

### 1. Image Copying Utility Function
- **Function**: `copyImageToCloudStorage(externalUrl, tenantId, filename)`
- **Location**: `server.js` lines ~7815-7870
- **Purpose**: Downloads images from external URLs and uploads them to Google Cloud Storage

### 2. Enhanced Product Sync
- **Location**: `server.js` lines ~6814-6837  
- **Enhancement**: When `forceImages` is enabled, product images are copied from Foodics to cloud storage
- **Filename Format**: `{sku}_{timestamp}.{extension}` or `{productName}_{timestamp}.{extension}`

### 3. Enhanced Category Sync  
- **Location**: `server.js` lines ~6455-6478
- **Enhancement**: When `forceImages` is enabled, category images are copied from Foodics to cloud storage
- **Filename Format**: `category_{ref}_{timestamp}.{extension}` or `category_{name}_{timestamp}.{extension}`

### 4. Integrated with Existing UI
- **Frontend**: No changes needed - uses existing "Sync with Foodics" modal
- **Checkbox**: "With Images" option already exists
- **API Endpoint**: Existing `/admin/tenants/:id/integrations/foodics/sync?force_images=1`

## How It Works

### Step 1: User Action
1. Go to admin products page
2. Click "Sync" button  
3. Check "With Images (overwrite product/category images from Foodics)"
4. Click "Proceed"

### Step 2: Backend Processing
1. Foodics sync starts with `force_images=1` parameter
2. For each product/category with an image URL:
   - Downloads image from Foodics URL
   - Generates unique filename with tenant/product info
   - Uploads to `gs://smart-order-assets-me-central1-715493130630/tenants/{tenantId}/products/{filename}`
   - Updates database with new cloud storage URL

### Step 3: Result
- All images now stored in your Google Cloud Storage
- Product API returns cloud storage URLs (via `normalizeImageUrl()`)
- Frontend displays images from your bucket consistently
- Images persist even if Foodics changes their URLs

## Cloud Storage Structure
```
smart-order-assets-me-central1-715493130630/
├── tenants/
│   └── {tenant-id}/
│       ├── products/
│       │   ├── PROD_SKU_1234567890.jpg
│       │   ├── Another_Product_1234567891.png
│       │   └── category_drinks_1234567892.jpg
│       └── logos/ (existing)
```

## Benefits

### 1. Image Persistence 
- Images survive Foodics URL changes
- No more broken image links
- Consistent image serving

### 2. Performance
- Images served from Google Cloud CDN
- Faster loading times
- Better reliability

### 3. Control
- Full ownership of image assets
- Can modify/optimize images if needed
- Independent of external API availability

### 4. Consistency
- Same cloud storage in local development and production
- Unified image serving approach

## Configuration Required

### Environment Variables (Already Set)
```bash
ASSETS_BUCKET=smart-order-assets-me-central1-715493130630
ASSETS_CACHE_CONTROL=public, max-age=31536000, immutable
```

### Prerequisites
- Google Cloud Storage bucket configured
- Service account with write permissions
- `@google-cloud/storage` package installed (already done)

## Error Handling

### Graceful Degradation
- If image download fails: keeps original Foodics URL
- If cloud upload fails: keeps original Foodics URL  
- If bucket not configured: skips image copying
- Logs all errors for debugging

### Console Logging
```
Copying image for product Coffee Latte: https://foodics-external.com/image.jpg
Successfully copied image to: https://storage.googleapis.com/your-bucket/tenants/.../products/latte_1234567890.jpg
```

## Testing the Feature

### 1. Verify Setup
```bash
# Check server is running with new code
curl http://localhost:3000/health

# Check bucket configuration
echo $ASSETS_BUCKET
```

### 2. Test Sync
1. Open http://localhost:3000/products/
2. Select tenant
3. Click "Sync" 
4. Enable "With Images"
5. Click "Proceed"
6. Monitor console logs for image copying

### 3. Verify Results
```bash
# Check if images are in cloud storage
gsutil ls gs://smart-order-assets-me-central1-715493130630/tenants/

# Check API returns cloud URLs
curl "http://localhost:3000/api/products" | jq -r '.[0].image_url'
```

## Production Considerations

### Same Code Works in Production
- Environment variables will be set in Cloud Run
- Same Google Cloud Storage bucket  
- Same service account permissions
- No additional changes needed

### Monitoring
- Check Cloud Storage usage/costs
- Monitor sync performance (may be slower with image copying)
- Watch for failed image downloads in logs

## Future Enhancements

### Potential Improvements
1. **Image Optimization**: Resize/compress images during upload
2. **Duplicate Detection**: Skip re-downloading existing images
3. **Batch Processing**: Parallel image downloads for faster sync
4. **Webhooks**: Real-time image updates from Foodics
5. **Image Variants**: Generate thumbnails/different sizes

### Rollback Plan
If issues occur, the sync can be run with "With Images" unchecked to revert to original Foodics URLs.

---

## Summary
✅ **Feature Complete**: Image sync from Foodics to Google Cloud Storage is fully implemented and integrated with existing UI.

✅ **Production Ready**: Same code works in both local development and production environments.

✅ **Safe**: Graceful error handling ensures sync doesn't break if image copying fails.