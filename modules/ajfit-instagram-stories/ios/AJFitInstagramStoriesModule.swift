import ExpoModulesCore
import Foundation
import OSLog
import Photos
import UIKit

private let baseStoriesURL = URL(string: "instagram-stories://share")!
private let instagramAppURL = URL(string: "instagram://app")!
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

@MainActor
private func isInstagramAppInstalled() -> Bool {
  UIApplication.shared.canOpenURL(instagramAppURL)
}

private func requestAddOnlyPhotoAccess() async -> Bool {
  await withCheckedContinuation { continuation in
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      continuation.resume(returning: status == .authorized || status == .limited)
    }
  }
}

/// `.addOnly` is the iOS 14+ access level for writing new Photos assets
/// without ever being granted permission to read the user's existing
/// library — the only level this flow needs, since it only ever creates one
/// new asset and reads back its own placeholder identifier synchronously.
/// `.limited` is treated as sufficient too: for `.addOnly` it still permits
/// creating the asset (the "limited" distinction only restricts which
/// existing assets are visible on read, which this flow never does).
private func ensureAddOnlyPhotoAccess() async -> Bool {
  let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
  switch status {
  case .authorized, .limited:
    return true
  case .notDetermined:
    return await requestAddOnlyPhotoAccess()
  case .denied, .restricted:
    return false
  @unknown default:
    return false
  }
}

/// Creates a new Photos asset from `image` and returns its `localIdentifier`.
/// Uses only `PHAssetChangeRequest.creationRequestForAsset(from:)` — a
/// write-only call — and reads the identifier off the change request's own
/// placeholder inside the same `performChanges` block. No `PHAsset` fetch or
/// query against the library ever happens, so this never touches (or needs
/// read access to) the user's existing photos.
private func createPhotoLibraryAsset(from image: UIImage) async throws -> String {
  try await withCheckedThrowingContinuation { continuation in
    var placeholder: PHObjectPlaceholder?
    PHPhotoLibrary.shared().performChanges({
      let request = PHAssetChangeRequest.creationRequestForAsset(from: image)
      placeholder = request.placeholderForCreatedAsset
    }, completionHandler: { success, error in
      if success, let identifier = placeholder?.localIdentifier {
        continuation.resume(returning: identifier)
      } else {
        continuation.resume(throwing: error ?? InstagramFeedAssetCreationFailedException())
      }
    })
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

    AsyncFunction("isInstagramAppAvailable") { () -> Bool in
      let available = await MainActor.run { isInstagramAppInstalled() }
      devLog("feed_app_available", "available=\(available)")
      return available
    }

    // Feed sharing has no pasteboard contract like Stories does — Instagram
    // only accepts a feed image via a Photos `localIdentifier`, so this asset
    // has to actually exist in the user's Photos library first. It is
    // created with `.addOnly` authorization only: this flow never fetches or
    // reads any pre-existing asset, so it never needs (and never requests)
    // read access to the rest of the user's library. The created asset is
    // intentionally left in the Photos library afterwards — Instagram reads
    // it asynchronously after the handoff, and there's no way to know when
    // it's done, so deleting it here would risk racing Instagram's own read.
    AsyncFunction("shareToFeed") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL else {
        devLog("feed_jpeg_missing", "reason=invalid_file_url")
        throw InvalidInstagramFeedFileException()
      }
      guard FileManager.default.fileExists(atPath: url.path) else {
        devLog("feed_jpeg_missing", "reason=file_not_found")
        throw InvalidInstagramFeedFileException()
      }
      devLog("feed_jpeg_exists")

      let imageData: Data
      do {
        imageData = try Data(contentsOf: url, options: .mappedIfSafe)
      } catch {
        devLog("feed_jpeg_read_failed", "reason=read_error")
        throw InvalidInstagramFeedFileException()
      }
      guard imageData.count >= 3, imageData.starts(with: [0xFF, 0xD8, 0xFF]) else {
        devLog("feed_jpeg_read_failed", "reason=invalid_jpeg")
        throw InvalidInstagramFeedJPEGException()
      }
      guard let image = UIImage(data: imageData) else {
        devLog("feed_jpeg_decode_failed")
        throw InvalidInstagramFeedJPEGException()
      }
      devLog("feed_jpeg_read_succeeded", "nonEmpty=true jpegSignature=true")

      let appAvailable = await MainActor.run { isInstagramAppInstalled() }
      guard appAvailable else {
        devLog("feed_instagram_unavailable")
        throw InstagramFeedUnavailableException()
      }
      devLog("feed_instagram_available")

      let authorized = await ensureAddOnlyPhotoAccess()
      guard authorized else {
        devLog("feed_photo_permission_denied")
        throw InstagramFeedPhotoPermissionException()
      }
      devLog("feed_photo_permission_granted", "level=addOnly")

      let localIdentifier: String
      do {
        localIdentifier = try await createPhotoLibraryAsset(from: image)
      } catch {
        devLog("feed_asset_creation_failed")
        throw InstagramFeedAssetCreationFailedException()
      }
      devLog("feed_asset_created")

      guard var components = URLComponents(string: "instagram://library") else {
        devLog("feed_url_build_failed")
        throw InstagramFeedURLException()
      }
      components.queryItems = [URLQueryItem(name: "LocalIdentifier", value: localIdentifier)]
      guard let libraryURL = components.url else {
        devLog("feed_url_build_failed")
        throw InstagramFeedURLException()
      }

      let opened = await openStoriesURL(libraryURL)
      guard opened else {
        devLog("feed_open_rejected")
        throw InstagramFeedOpenRejectedException()
      }
      // As with Stories, this only confirms iOS accepted the URL handoff —
      // not that Instagram loaded the asset into its feed composer.
      devLog("feed_open_accepted")
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

private final class InvalidInstagramFeedFileException: Exception {
  override var reason: String { "Instagram feed share requires an existing local file" }
}

private final class InvalidInstagramFeedJPEGException: Exception {
  override var reason: String { "Instagram feed share requires a valid JPEG image" }
}

private final class InstagramFeedUnavailableException: Exception {
  override var reason: String { "Instagram is not installed" }
}

private final class InstagramFeedPhotoPermissionException: Exception {
  override var reason: String { "Photos add-only permission was not granted" }
}

private final class InstagramFeedAssetCreationFailedException: Exception {
  override var reason: String { "Could not create the Photos asset for Instagram feed sharing" }
}

private final class InstagramFeedURLException: Exception {
  override var reason: String { "Instagram feed URL could not be created" }
}

private final class InstagramFeedOpenRejectedException: Exception {
  override var reason: String { "iOS rejected the Instagram feed URL handoff" }
}
