package com.ajfit.appcheck

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

internal object AJFitAppCheckProvider {
  fun factory(): AppCheckProviderFactory =
    PlayIntegrityAppCheckProviderFactory.getInstance()
}
