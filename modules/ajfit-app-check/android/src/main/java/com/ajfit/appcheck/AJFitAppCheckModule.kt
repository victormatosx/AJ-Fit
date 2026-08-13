package com.ajfit.appcheck

import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AJFitAppCheckModule : Module() {
  @Volatile
  private var providerInstalled = false

  private fun configuredAppCheck(): FirebaseAppCheck {
    val context = appContext.reactContext ?: throw Exceptions.AppContextLost()
    val firebaseApp = FirebaseApp.initializeApp(context)
      ?: throw IllegalStateException("Firebase native app could not be initialized.")
    val appCheck = FirebaseAppCheck.getInstance(firebaseApp)

    if (!providerInstalled) {
      synchronized(this) {
        if (!providerInstalled) {
          appCheck.installAppCheckProviderFactory(
            AJFitAppCheckProvider.factory(),
            false,
          )
          providerInstalled = true
        }
      }
    }
    return appCheck
  }

  override fun definition() = ModuleDefinition {
    Name("AJFitAppCheck")

    AsyncFunction("getAppCheckToken") { forceRefresh: Boolean, promise: Promise ->
      val appCheck = try {
        configuredAppCheck()
      } catch (error: Throwable) {
        promise.reject(
          "ERR_APP_CHECK_INITIALIZATION",
          "Firebase App Check initialization failed.",
          error,
        )
        return@AsyncFunction
      }

      appCheck.getAppCheckToken(forceRefresh)
        .addOnSuccessListener { result ->
          promise.resolve(
            mapOf(
              "token" to result.token,
              "expireTimeMillis" to result.expireTimeMillis.toDouble(),
            ),
          )
        }
        .addOnFailureListener { error ->
          promise.reject(
            "ERR_APP_CHECK_TOKEN",
            "Firebase App Check token request failed.",
            error,
          )
        }
    }
  }
}
