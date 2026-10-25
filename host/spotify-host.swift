// Native messaging host: drives the Spotify desktop app via AppleScript.
// Protocol: 4-byte little-endian length prefix + UTF-8 JSON, both directions.
import Foundation

let stdin = FileHandle.standardInput
let stdout = FileHandle.standardOutput

func readMessage() -> [String: Any]? {
    let header = stdin.readData(ofLength: 4)
    guard header.count == 4 else { return nil }
    let length = header.withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
    let body = stdin.readData(ofLength: Int(length))
    guard body.count == Int(length) else { return nil }
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
}

func writeMessage(_ msg: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: msg) else { return }
    var length = UInt32(body.count).littleEndian
    stdout.write(Data(bytes: &length, count: 4))
    stdout.write(body)
}

/// Runs a command found on PATH and returns trimmed stdout.
func shell(_ cmd: String, _ args: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [cmd] + args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return "" }
    let out = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(decoding: out, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}

func osa(_ script: String) -> String { shell("osascript", ["-e", script]) }

func isRunning() -> Bool {
    osa("tell application \"System Events\" to (name of processes) contains \"Spotify\"") == "true"
}

/// Launches Spotify hidden in the background and waits (≤5 s) for it to appear.
func ensureRunning() -> Bool {
    if isRunning() { return true }
    _ = shell("open", ["-gj", "-a", "Spotify"])
    for _ in 0..<25 {
        if isRunning() { return true }
        Thread.sleep(forTimeInterval: 0.2)
    }
    return isRunning()
}

func status() -> [String: Any] {
    guard isRunning() else { return ["ok": true, "running": false] }
    return [
        "ok": true, "running": true,
        "state": osa("tell application \"Spotify\" to player state as string"),
        "track": osa("tell application \"Spotify\" to name of current track"),
    ]
}

func handle(_ msg: [String: Any]) -> [String: Any] {
    switch msg["cmd"] as? String {
    case "status":
        return status()
    case "commercial":
        guard ensureRunning() else { return ["ok": false, "running": false, "error": "could not launch Spotify"] }
        _ = osa("tell application \"Spotify\" to play")
        return ["ok": true, "running": true]
    case "game":
        guard isRunning() else { return ["ok": true, "running": false] }
        _ = osa("tell application \"Spotify\" to pause")
        return ["ok": true, "running": true]
    case "play_uri":
        guard let uri = msg["uri"] as? String, uri.hasPrefix("spotify:") else { return ["ok": false, "error": "bad uri"] }
        guard ensureRunning() else { return ["ok": false, "running": false, "error": "could not launch Spotify"] }
        let escaped = uri.replacingOccurrences(of: "\"", with: "")
        _ = osa("tell application \"Spotify\" to play track \"\(escaped)\"")
        return ["ok": true, "running": true]
    default:
        return ["ok": false, "error": "unknown cmd"]
    }
}

while let msg = readMessage() {
    writeMessage(handle(msg))
}
