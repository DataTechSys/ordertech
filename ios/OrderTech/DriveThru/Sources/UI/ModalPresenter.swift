import SwiftUI

// MARK: - Modal Presenter Utility
/// Utility for presenting modals with consistent orientation-aware sizing
/// Note: OrientationModel is defined in Sources/OrientationModel.swift
struct OrientationAwareModal<ContentView: View>: ViewModifier {
    @EnvironmentObject private var orientation: OrientationModel
    let content: () -> ContentView
    
    func body(content: Content) -> some View {
        content
            .overlay {
                self.content()
                    .frame(
                        maxWidth: orientation.isLandscape ? UIScreen.main.bounds.width * 0.6 : .infinity,
                        maxHeight: orientation.isLandscape ? UIScreen.main.bounds.height * 0.8 : .infinity
                    )
                    .frame(maxWidth: orientation.isLandscape ? 600 : .infinity) // Cap width in landscape
            }
    }
}

extension View {
    /// Applies orientation-aware modal presentation
    func orientationAwareModal<ContentView: View>(@ViewBuilder content: @escaping () -> ContentView) -> some View {
        self.modifier(OrientationAwareModal(content: content))
    }
}

// MARK: - Orientation-Aware Frame Modifier
struct ResponsiveFrameModifier: ViewModifier {
    @EnvironmentObject private var orientation: OrientationModel
    
    let portraitWidth: CGFloat?
    let portraitHeight: CGFloat?
    let landscapeWidth: CGFloat?
    let landscapeHeight: CGFloat?
    let portraitMaxWidth: CGFloat?
    let portraitMaxHeight: CGFloat?
    let landscapeMaxWidth: CGFloat?
    let landscapeMaxHeight: CGFloat?
    
    init(
        portraitWidth: CGFloat? = nil,
        portraitHeight: CGFloat? = nil,
        landscapeWidth: CGFloat? = nil,
        landscapeHeight: CGFloat? = nil,
        portraitMaxWidth: CGFloat? = nil,
        portraitMaxHeight: CGFloat? = nil,
        landscapeMaxWidth: CGFloat? = nil,
        landscapeMaxHeight: CGFloat? = nil
    ) {
        self.portraitWidth = portraitWidth
        self.portraitHeight = portraitHeight
        self.landscapeWidth = landscapeWidth
        self.landscapeHeight = landscapeHeight
        self.portraitMaxWidth = portraitMaxWidth
        self.portraitMaxHeight = portraitMaxHeight
        self.landscapeMaxWidth = landscapeMaxWidth
        self.landscapeMaxHeight = landscapeMaxHeight
    }
    
    func body(content: Content) -> some View {
        if orientation.isLandscape {
            content
                .frame(width: landscapeWidth, height: landscapeHeight)
                .frame(maxWidth: landscapeMaxWidth, maxHeight: landscapeMaxHeight)
        } else {
            content
                .frame(width: portraitWidth, height: portraitHeight)
                .frame(maxWidth: portraitMaxWidth, maxHeight: portraitMaxHeight)
        }
    }
}

extension View {
    /// Applies responsive frame sizing based on orientation
    func responsiveFrame(
        portraitWidth: CGFloat? = nil,
        portraitHeight: CGFloat? = nil,
        landscapeWidth: CGFloat? = nil,
        landscapeHeight: CGFloat? = nil,
        portraitMaxWidth: CGFloat? = nil,
        portraitMaxHeight: CGFloat? = nil,
        landscapeMaxWidth: CGFloat? = nil,
        landscapeMaxHeight: CGFloat? = nil
    ) -> some View {
        self.modifier(ResponsiveFrameModifier(
            portraitWidth: portraitWidth,
            portraitHeight: portraitHeight,
            landscapeWidth: landscapeWidth,
            landscapeHeight: landscapeHeight,
            portraitMaxWidth: portraitMaxWidth,
            portraitMaxHeight: portraitMaxHeight,
            landscapeMaxWidth: landscapeMaxWidth,
            landscapeMaxHeight: landscapeMaxHeight
        ))
    }
}

// NOTE: ResponsivePaddingModifier is defined in DisplayHomeView.swift to avoid duplication

// MARK: - Screen-Edge Safe Area Modifier
struct OrientationSafeAreaModifier: ViewModifier {
    @EnvironmentObject private var orientation: OrientationModel
    let ignoreKeyboard: Bool
    
    func body(content: Content) -> some View {
        content
            .ignoresSafeArea(.keyboard, edges: ignoreKeyboard ? .all : [])
            .safeAreaInset(edge: .top) {
                // Dynamic island/notch spacing - more critical in landscape
                Color.clear.frame(height: orientation.isLandscape ? 8 : 0)
            }
    }
}

extension View {
    /// Handles safe areas appropriately for both orientations
    func orientationSafeArea(ignoreKeyboard: Bool = false) -> some View {
        self.modifier(OrientationSafeAreaModifier(ignoreKeyboard: ignoreKeyboard))
    }
}