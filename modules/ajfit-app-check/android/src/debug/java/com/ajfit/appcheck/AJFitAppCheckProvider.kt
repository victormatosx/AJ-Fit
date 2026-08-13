package com.ajfit.appcheck

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

internal object AJFitAppCheckProvider {
  fun factory(): AppCheckProviderFactory = DebugAppCheckProviderFactory.getInstance()
}
