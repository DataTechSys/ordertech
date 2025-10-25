import Foundation
import AVFoundation

#if targetEnvironment(simulator)
print("Running test TTS in simulator environment")

// Test macOS system TTS using 'say' command
let testText = "Hello from OrderTech DisplayApp! TTS is working on macOS."
print("Testing macOS system TTS with text: \(testText)")

let task = Process()
task.launchPath = "/usr/bin/say"
task.arguments = [testText]

do {
    try task.run()
    task.waitUntilExit()
    print("macOS TTS test completed with exit code: \(task.terminationStatus)")
} catch {
    print("macOS TTS test failed with error: \(error)")
}

#else
print("Running test TTS in iOS environment")

// Test iOS TTS
let synthesizer = AVSpeechSynthesizer()
let utterance = AVSpeechUtterance(string: "Hello from OrderTech DisplayApp! TTS is working on iOS.")
utterance.rate = 0.5
utterance.volume = 1.0

synthesizer.speak(utterance)
print("iOS TTS test initiated")

// Keep running to let TTS complete
RunLoop.main.run(until: Date(timeIntervalSinceNow: 5))
#endif