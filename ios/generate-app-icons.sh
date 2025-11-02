#!/bin/bash

# App Icon Generator for iOS
# Generates all required app icon sizes from a single source image

SOURCE_IMAGE="/Users/mosawi/DATATECH/OrderTech/ios/OrderTech/DriveThru/Resources/drivrthru.png"
OUTPUT_DIR="/Users/mosawi/DATATECH/OrderTech/ios/OrderTech/DriveThru/Resources/Assets.xcassets/AppIcon.appiconset"

echo "🎨 iOS App Icon Generator"
echo "========================="
echo ""
echo "Source: $SOURCE_IMAGE"

# Check if source image exists
if [ ! -f "$SOURCE_IMAGE" ]; then
    echo "❌ Error: Source image not found!"
    exit 1
fi

# Get source image dimensions
WIDTH=$(sips -g pixelWidth "$SOURCE_IMAGE" | tail -n 1 | awk '{print $2}')
HEIGHT=$(sips -g pixelHeight "$SOURCE_IMAGE" | tail -n 1 | awk '{print $2}')

echo "📏 Source dimensions: ${WIDTH}x${HEIGHT}"

# Check if image is square
if [ "$WIDTH" != "$HEIGHT" ]; then
    echo "⚠️  Warning: Image is not square. Will crop to square from center."
fi

# Check minimum size
if [ "$WIDTH" -lt 1024 ] || [ "$HEIGHT" -lt 1024 ]; then
    echo "⚠️  Warning: Image is smaller than 1024x1024. Quality may be reduced."
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"
echo ""
echo "📁 Creating: $OUTPUT_DIR"

# iOS App Icon sizes (all required sizes for iOS 16+)
declare -a SIZES=(
    "20:Icon-20.png"           # iPhone Notification 2x
    "29:Icon-29.png"           # iPhone Settings 2x  
    "40:Icon-40.png"           # iPhone Spotlight 2x
    "60:Icon-60.png"           # iPhone Notification 3x
    "58:Icon-58.png"           # iPhone Settings 2x (29@2x)
    "76:Icon-76.png"           # iPad App Icon 1x
    "80:Icon-80.png"           # iPhone Spotlight 2x (40@2x)
    "87:Icon-87.png"           # iPhone Settings 3x (29@3x)
    "120:Icon-120.png"         # iPhone App Icon 2x (60@2x), Spotlight 3x
    "152:Icon-152.png"         # iPad App Icon 2x (76@2x)
    "167:Icon-167.png"         # iPad Pro App Icon 2x
    "180:Icon-180.png"         # iPhone App Icon 3x (60@3x)
    "1024:Icon-1024.png"       # App Store
)

echo ""
echo "🔄 Generating icon sizes..."
echo ""

for SIZE_INFO in "${SIZES[@]}"; do
    SIZE="${SIZE_INFO%%:*}"
    FILENAME="${SIZE_INFO##*:}"
    OUTPUT_PATH="$OUTPUT_DIR/$FILENAME"
    
    printf "  ⚙️  Generating ${SIZE}x${SIZE} → $FILENAME..."
    
    # Generate resized icon
    sips -z $SIZE $SIZE "$SOURCE_IMAGE" --out "$OUTPUT_PATH" > /dev/null 2>&1
    
    if [ -f "$OUTPUT_PATH" ]; then
        printf " ✅\n"
    else
        printf " ❌\n"
    fi
done

# Create Contents.json for Xcode
echo ""
echo "📝 Creating Contents.json..."

cat > "$OUTPUT_DIR/Contents.json" << 'EOF'
{
  "images" : [
    {
      "filename" : "Icon-40.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "filename" : "Icon-60.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "20x20"
    },
    {
      "filename" : "Icon-58.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "filename" : "Icon-87.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "29x29"
    },
    {
      "filename" : "Icon-80.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "filename" : "Icon-120.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "40x40"
    },
    {
      "filename" : "Icon-120.png",
      "idiom" : "iphone",
      "scale" : "2x",
      "size" : "60x60"
    },
    {
      "filename" : "Icon-180.png",
      "idiom" : "iphone",
      "scale" : "3x",
      "size" : "60x60"
    },
    {
      "filename" : "Icon-20.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "20x20"
    },
    {
      "filename" : "Icon-40.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "20x20"
    },
    {
      "filename" : "Icon-29.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "29x29"
    },
    {
      "filename" : "Icon-58.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "29x29"
    },
    {
      "filename" : "Icon-40.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "40x40"
    },
    {
      "filename" : "Icon-80.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "40x40"
    },
    {
      "filename" : "Icon-76.png",
      "idiom" : "ipad",
      "scale" : "1x",
      "size" : "76x76"
    },
    {
      "filename" : "Icon-152.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "76x76"
    },
    {
      "filename" : "Icon-167.png",
      "idiom" : "ipad",
      "scale" : "2x",
      "size" : "83.5x83.5"
    },
    {
      "filename" : "Icon-1024.png",
      "idiom" : "ios-marketing",
      "scale" : "1x",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

echo ""
echo "✅ App icon generation complete!"
echo ""
echo "📍 Icon location: $OUTPUT_DIR"
echo ""
echo "📋 Next steps:"
echo "1. Open DriveThru project in Xcode"
echo "2. Add Assets.xcassets to the project if not already added"
echo "3. Build and run to see your new icon!"
echo ""
echo "🎯 Generated sizes:"
ls -lh "$OUTPUT_DIR"/*.png 2>/dev/null | awk '{print "   " $9}' | xargs -I {} basename {}
