import ExpoModulesCore
import WidgetKit

/// Deliberately tiny — see `modules/ajfit-widgets/index.ts`'s doc comment.
/// Every Function here is a direct pass-through to `AJFitWidgetsStorage`
/// (or, for `requestReload`, to `WidgetCenter`); none of them decide
/// anything about what the snapshot means.
public final class AJFitWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AJFitWidgets")

    Function("writeSnapshot") { (json: String) -> Void in
      if !AJFitWidgetsStorage.write(json: json) {
        // A malformed payload here is a JS-side bug — `buildWidgetSnapshot`
        // is strongly typed and always produces valid, versioned JSON — not
        // a condition the user can act on. Log and move on; never throw and
        // tear down the calling await chain for it.
        NSLog("[ajfit-widgets:ios] native_error operation=write reason=structurally_invalid")
      }
    }

    Function("clearSnapshot") { () -> Void in
      AJFitWidgetsStorage.clear()
    }

    Function("readSnapshotForDebug") { () -> String? in
      AJFitWidgetsStorage.readRaw()
    }

    Function("requestReload") { () -> Void in
      // Real, not a stub: harmless with zero registered widget kinds today
      // (Phase 3 adds `AJFitWidgetsExtension`). Phase 3/4 do not need to
      // touch this call site at all once the extension exists.
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
