import SwiftUI

/// SwiftUI view that handles external display content with rotation and scale-to-fill functionality.
/// 
/// This view:
/// - Rotates the content 90 degrees when rotationEnabled is true
/// - Scales the content to fill the external screen completely 
/// - Uses black background to avoid letterboxing
/// - Ignores safe areas since external displays typically don't need insets
struct ExternalDisplayRootView<Content: View>: View {
    let rotationEnabled: Bool
    let baseDeviceSize: CGSize
    let content: Content
    
    init(rotationEnabled: Bool, baseDeviceSize: CGSize, @ViewBuilder content: () -> Content) {
        self.rotationEnabled = rotationEnabled
        self.baseDeviceSize = baseDeviceSize
        self.content = content()
    }
    
    var body: some View {
        GeometryReader { geometry in
            let containerSize = geometry.size
            
            // Always rotate when rotationEnabled is true
            let shouldRotate = rotationEnabled
            
            // Calculate the size after rotation
            let rotatedSize: CGSize = shouldRotate
                ? CGSize(width: baseDeviceSize.height, height: baseDeviceSize.width)
                : baseDeviceSize
            
            // Calculate scale factor to fill the container
            let scaleX = containerSize.width / rotatedSize.width
            let scaleY = containerSize.height / rotatedSize.height
            let scaleFactor = max(scaleX, scaleY) // Use max to fill completely
            
            // Debug logging
            let _ = print("[ExternalDisplayRootView] Container: \(containerSize), Base: \(baseDeviceSize), Rotate: \(shouldRotate), Scale: \(scaleFactor)")
            
            content
                .frame(width: baseDeviceSize.width, height: baseDeviceSize.height)
                .rotationEffect(.degrees(shouldRotate ? 90 : 0))
                .scaleEffect(scaleFactor)
                .position(x: containerSize.width / 2, y: containerSize.height / 2)
                .clipped()
        }
        .background(Color.black) // Black background to avoid letterboxing artifacts
        .ignoresSafeArea(.all) // External displays typically don't need safe area insets
    }
}

#if DEBUG
struct ExternalDisplayRootView_Previews: PreviewProvider {
    static var previews: some View {
        ExternalDisplayRootView(
            rotationEnabled: true,
            baseDeviceSize: CGSize(width: 820, height: 1180)
        ) {
            VStack {
                Text("Sample Content")
                    .font(.largeTitle)
                Rectangle()
                    .fill(Color.blue)
                    .frame(height: 200)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
        }
        .previewLayout(.fixed(width: 1920, height: 1080))
        .previewDisplayName("External Display Rotated")
        
        ExternalDisplayRootView(
            rotationEnabled: false,
            baseDeviceSize: CGSize(width: 820, height: 1180)
        ) {
            VStack {
                Text("Sample Content")
                    .font(.largeTitle)
                Rectangle()
                    .fill(Color.green)
                    .frame(height: 200)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white)
        }
        .previewLayout(.fixed(width: 1920, height: 1080))
        .previewDisplayName("External Display Normal")
    }
}
#endif