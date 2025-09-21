import Foundation
import SwiftUI
#if canImport(WebRTC)
import WebRTC
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif

// Legacy AVFoundation preview kept only for fallback if WebRTC is unavailable.
#if !canImport(WebRTC)
final class LocalCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private var videoInput: AVCaptureDeviceInput?
    private let queue = DispatchQueue(label: "LocalCameraController.queue")

    func start() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if self.session.isRunning { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .high
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) ??
                                AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified) else {
                self.session.commitConfiguration(); return
            }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) { self.session.addInput(input); self.videoInput = input }
            } catch {
                self.session.commitConfiguration(); return
            }
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if !self.session.isRunning { return }
            self.session.stopRunning()
        }
    }
}

struct LocalCameraView: UIViewRepresentable {
    @ObservedObject var controller: LocalCameraController
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView(); v.videoPreviewLayer.session = controller.session; v.videoPreviewLayer.videoGravity = .resizeAspectFill; return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) { uiView.videoPreviewLayer.session = controller.session }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
#endif

// Lightweight AVFoundation preview that works regardless of WebRTC availability.
#if canImport(AVFoundation)
final class PreconnectCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private var videoInput: AVCaptureDeviceInput?
    private let queue = DispatchQueue(label: "PreconnectCameraController.queue")

    func start() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if self.session.isRunning { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .high
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) ??
                                AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .unspecified) else {
                self.session.commitConfiguration(); return
            }
            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) { self.session.addInput(input); self.videoInput = input }
            } catch {
                self.session.commitConfiguration(); return
            }
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            if !self.session.isRunning { return }
            self.session.stopRunning()
        }
    }
}

struct PreconnectLocalPreview: UIViewRepresentable {
    @ObservedObject var controller: PreconnectCameraController
    func makeUIView(context: Context) -> PrePreviewView {
        let v = PrePreviewView(); v.videoPreviewLayer.session = controller.session; v.videoPreviewLayer.videoGravity = .resizeAspectFill; return v
    }
    func updateUIView(_ uiView: PrePreviewView, context: Context) { uiView.videoPreviewLayer.session = controller.session }
}

final class PrePreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
#endif

// New RTC-based local preview
#if canImport(WebRTC)
struct LocalRTCView: UIViewRepresentable {
    let service: WebRTCService
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let v = RTCMTLVideoView()
        v.videoContentMode = .scaleAspectFill
        service.set(localRenderer: v)
        return v
    }
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) { }
}
#endif

#if canImport(LiveKit)
import LiveKit
struct LiveKitLocalView: UIViewRepresentable {
    let livekit: LiveKitRTC
    func makeUIView(context: Context) -> VideoView {
        let v = VideoView()
        v.contentMode = .scaleAspectFill
        livekit.setLocalVideoView(v)
        return v
    }
    func updateUIView(_ uiView: VideoView, context: Context) { }
}
#endif

