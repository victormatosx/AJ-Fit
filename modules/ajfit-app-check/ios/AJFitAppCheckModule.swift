

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

      AppCheck.appCheck().token(forcingRefresh: forceRefresh) { result, error in
        if error != nil {
          promise.reject(
            "ERR_APP_CHECK_TOKEN",
            "Firebase App Check token request failed."
          )
          return
        }

        guard let result else {
          promise.reject(
            "ERR_APP_CHECK_TOKEN",
            "Firebase App Check returned no token."
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
