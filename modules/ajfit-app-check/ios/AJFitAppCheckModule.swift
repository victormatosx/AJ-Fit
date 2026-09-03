

import ExpoModulesCore
import FirebaseAppCheck
import FirebaseCore

enum AJFitAppCheckConfigurator {
  private static let configurationLock = NSLock()

  static func configureNativeFirebaseIfNeeded() {
    configurationLock.lock()
    defer { configurationLock.unlock() }

    guard FirebaseApp.app() == nil else { return }

    #if DEBUG
    AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
    #else
    AppCheck.setAppCheckProviderFactory(AppAttestProviderFactory())
    #endif

    FirebaseApp.configure()
    AppCheck.appCheck().isTokenAutoRefreshEnabled = false
  }
}

public final class AJFitAppCheckAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  @MainActor
  public func appDelegateWillBeginInitialization() {
    AJFitAppCheckConfigurator.configureNativeFirebaseIfNeeded()
  }
}

public final class AJFitAppCheckModule: Module {

  public func definition() -> ModuleDefinition {
    Name("AJFitAppCheck")

    OnCreate {
      AJFitAppCheckConfigurator.configureNativeFirebaseIfNeeded()
    }

    AsyncFunction("getAppCheckToken") { (forceRefresh: Bool, promise: Promise) in
      AJFitAppCheckConfigurator.configureNativeFirebaseIfNeeded()

      // Defensive/diagnostic only — `configureNativeFirebaseIfNeeded()` above
      // is the sole place `FirebaseApp.configure()` is ever called in this
      // codebase (guarded, idempotent, provider-factory-set-before-configure).
      // In practice this should never be nil by this point; if it somehow is
      // (e.g. a future change adds a second `FirebaseApp.configure()` call
      // elsewhere and races this one), fail with a distinct, greppable code
      // instead of letting `AppCheck.appCheck()` hit its own internal
      // "not configured" fatal path with zero diagnostic value on the JS side.
      guard FirebaseApp.app() != nil else {
        promise.reject(
          "ERR_APP_CHECK_NOT_CONFIGURED",
          "FirebaseApp.app() is nil after configureNativeFirebaseIfNeeded() — native Firebase was never configured."
        )
        return
      }

      AppCheck.appCheck().token(forcingRefresh: forceRefresh) { result, error in
        if let error {
          // Previously this discarded `error` entirely and always reported the
          // same generic "Firebase App Check token request failed." — making
          // every real failure (debug token rejected by the server, network
          // unreachable, App Attest unavailable, keychain error, etc.)
          // indistinguishable from the JS side. Propagate the real
          // NSError code/domain/description instead so the failure category
          // is visible in the app's own logs, not just Xcode's console.
          let nsError = error as NSError
          promise.reject(
            "ERR_APP_CHECK_TOKEN",
            "Firebase App Check token request failed: [\(nsError.domain)#\(nsError.code)] \(nsError.localizedDescription)"
          )
          return
        }

        guard let result else {
          promise.reject(
            "ERR_APP_CHECK_TOKEN",
            "Firebase App Check returned no token and no error (unexpected SDK contract violation)."
          )
          return
        }

        promise.resolve([
          "token": result.token,
          "expireTimeMillis": result.expirationDate.timeIntervalSince1970 * 1000,
        ])
      }
    }
  }
}
