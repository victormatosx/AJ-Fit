import ExpoModulesCore
import Foundation
import OSLog
import UIKit

private let baseStoriesURL = URL(string: "instagram-stories://share")!
private let backgroundImageKey = "com.instagram.sharedSticker.backgroundImage"
private let sourceApplicationInfoKey = "AJFitInstagramStoriesMetaAppID"
private let pasteboardExpirationSeconds: TimeInterval = 300
private let storiesLogger = Logger(
  subsystem: Bundle.main.bundleIdentifier ?? "com.ajfit.app",
  category: "AJFitInstagramStories"
)

private func devLog(_ event: String, _ detail: String = "") {
#if DEBUG
  storiesLogger.debug("[instagram-stories:ios] \(event, privacy: .public) \(detail, privacy: .public)")
#endif
}

private func configuredMetaAppID() -> String? {
  guard let raw = Bundle.main.object(forInfoDictionaryKey: sourceApplicationInfoKey) as? String else {
    return nil
  }
  let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !value.isEmpty, value.allSatisfy(\.isNumber) else { return nil }
  return value
}

private func storiesURL(metaAppID: String) throws -> URL {
  guard var components = URLComponents(url: baseStoriesURL, resolvingAgainstBaseURL: false) else {
    throw InstagramURLException()
  }
  components.queryItems = [URLQueryItem(name: "source_application", value: metaAppID)]
  guard let url = components.url else { throw InstagramURLException() }
  return url
}

@MainActor
private func openStoriesURL(_ url: URL) async -> Bool {
  await withCheckedContinuation { continuation in
    UIApplication.shared.open(url, options: [:]) { accepted in
      continuation.resume(returning: accepted)
    }
  }
}

public final class AJFitInstagramStoriesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AJFitInstagramStories")

    AsyncFunction("getCapabilities") { () -> [String: Bool] in
      let schemeAvailable = await MainActor.run {
        UIApplication.shared.canOpenURL(baseStoriesURL)
      }
      let sourceConfigured = configuredMetaAppID() != nil
      // iOS exposes installation only through the declared URL scheme. Keep
      // both fields explicit so diagnostics show what was actually measured.
      devLog("capabilities", "installed=\(schemeAvailable) scheme=\(schemeAvailable) sourceConfigured=\(sourceConfigured)")
      return [
        "instagramInstalled": schemeAvailable,
        "schemeAvailable": schemeAvailable,
        "sourceApplicationConfigured": sourceConfigured,
      ]
    }

    AsyncFunction("isAvailable") { () -> Bool in
      let schemeAvailable = await MainActor.run {
        UIApplication.shared.canOpenURL(baseStoriesURL)
      }
      let sourceConfigured = configuredMetaAppID() != nil
      devLog("eligibility", "scheme=\(schemeAvailable) sourceConfigured=\(sourceConfigured)")
      return schemeAvailable && sourceConfigured
    }

    AsyncFunction("share") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL else {
        devLog("jpeg_missing", "reason=invalid_file_url")
        throw InvalidInstagramFileException()
      }
      guard FileManager.default.fileExists(atPath: url.path) else {
        devLog("jpeg_missing", "reason=file_not_found")
        throw InvalidInstagramFileException()
      }
      devLog("jpeg_exists")

      let imageData: Data
      do {
        imageData = try Data(contentsOf: url, options: .mappedIfSafe)
      } catch {
        devLog("jpeg_read_failed", "reason=read_error")
        throw InvalidInstagramFileException()
      }
      guard imageData.count >= 3, imageData.starts(with: [0xFF, 0xD8, 0xFF]) else {
        devLog("jpeg_read_failed", "reason=invalid_jpeg")
        throw InvalidInstagramJPEGException()
      }
      devLog("jpeg_read_succeeded", "nonEmpty=true jpegSignature=true")

      guard let metaAppID = configuredMetaAppID() else {
        devLog("source_application_missing")
        throw InstagramSourceApplicationException()
      }
      devLog("source_application_configured")
      let urlScheme = try storiesURL(metaAppID: metaAppID)

      let schemeAvailable = await MainActor.run {
        UIApplication.shared.canOpenURL(urlScheme)
      }
      guard schemeAvailable else {
        devLog("scheme_unavailable")
        throw InstagramUnavailableException()
      }
      devLog("scheme_available")

      let pasteboardWritten = await MainActor.run {
        let previousChangeCount = UIPasteboard.general.changeCount
        UIPasteboard.general.setItems(
          [[backgroundImageKey: imageData]],
          options: [.expirationDate: Date().addingTimeInterval(pasteboardExpirationSeconds)]
        )
        return UIPasteboard.general.changeCount > previousChangeCount
      }
      guard pasteboardWritten else {
        devLog("pasteboard_write_failed")
        throw InstagramPasteboardException()
      }
      devLog("pasteboard_written", "key=backgroundImage expirationSeconds=300")

      let opened = await openStoriesURL(urlScheme)
      guard opened else {
        devLog("open_url_rejected")
        throw InstagramOpenRejectedException()
      }
      // This means iOS accepted the URL handoff, not that Instagram published
      // or accepted the Story. No completion claim is made at this boundary.
      devLog("open_url_accepted")
    }
  }
}

private final class InvalidInstagramFileException: Exception {
  override var reason: String { "Instagram Stories requires an existing local file" }
}

private final class InvalidInstagramJPEGException: Exception {
  override var reason: String { "Instagram Stories requires a valid JPEG background image" }
}

private final class InstagramSourceApplicationException: Exception {
  override var reason: String { "Instagram Stories Meta App ID is not configured" }
}

private final class InstagramURLException: Exception {
  override var reason: String { "Instagram Stories URL could not be created" }
}

private final class InstagramUnavailableException: Exception {
  override var reason: String { "Instagram Stories URL scheme is unavailable" }
}

private final class InstagramPasteboardException: Exception {
  override var reason: String { "Instagram Stories pasteboard payload could not be written" }
}

private final class InstagramOpenRejectedException: Exception {
  override var reason: String { "iOS rejected the Instagram Stories URL handoff" }
}
