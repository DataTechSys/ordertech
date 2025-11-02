import Foundation
import SwiftUI
#if canImport(AVFoundation)
import AVFoundation

@MainActor
final class DisplayPreconnectCameraController: NSObject, ObservableObject {
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

struct DisplayPreconnectLocalPreview: UIViewRepresentable {
    @ObservedObject var controller: DisplayPreconnectCameraController
    typealias UIViewType = DisplayPrePreviewView

    func makeUIView(context: Context) -> DisplayPrePreviewView {
        let v = DisplayPrePreviewView()
        v.videoPreviewLayer.session = controller.session
        v.videoPreviewLayer.videoGravity = .resizeAspectFill
        return v
    }

    func updateUIView(_ uiView: DisplayPrePreviewView, context: Context) {
        // No-op; preview automatically updates when session changes
    }
}

final class DisplayPrePreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
#endif