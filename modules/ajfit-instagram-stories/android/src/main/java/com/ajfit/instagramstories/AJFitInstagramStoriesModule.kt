package com.ajfit.instagramstories

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val STORIES_ACTION = "com.instagram.share.ADD_TO_STORY"
private const val INSTAGRAM_PACKAGE = "com.instagram.android"
private const val JPEG_MIME = "image/jpeg"
private const val META_APP_ID_KEY = "com.ajfit.instagramstories.META_APP_ID"

private fun devLog(event: String, detail: String = "") {
  if (BuildConfig.DEBUG) Log.d("AJFitInstagramStories", "[instagram-stories:android] $event $detail")
}

class AJFitInstagramStoriesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AJFitInstagramStories")

    AsyncFunction("getCapabilities") {
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(STORIES_ACTION).apply {
        type = JPEG_MIME
        setPackage(INSTAGRAM_PACKAGE)
      }
      val schemeAvailable = context.packageManager.resolveActivity(intent, 0) != null
      val installed = try {
        context.packageManager.getPackageInfo(INSTAGRAM_PACKAGE, 0)
        true
      } catch (_: PackageManager.NameNotFoundException) {
        false
      }
      val sourceConfigured = configuredMetaAppId(context) != null
      devLog(
        "capabilities",
        "installed=$installed intent=$schemeAvailable sourceConfigured=$sourceConfigured",
      )
      mapOf(
        "instagramInstalled" to installed,
        "schemeAvailable" to schemeAvailable,
        "sourceApplicationConfigured" to sourceConfigured,
      )
    }

    AsyncFunction("isAvailable") {
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(STORIES_ACTION).apply {
        type = JPEG_MIME
        setPackage(INSTAGRAM_PACKAGE)
      }
      val schemeAvailable = context.packageManager.resolveActivity(intent, 0) != null
      val sourceConfigured = configuredMetaAppId(context) != null
      devLog("eligibility", "intent=$schemeAvailable sourceConfigured=$sourceConfigured")
      schemeAvailable && sourceConfigured
    }

    AsyncFunction("share") { uri: String ->
      val context = requireNotNull(appContext.reactContext)
      val source = Uri.parse(uri)
      require(source.scheme == "file") { "uri must be a file URI" }
      val sourceFile = File(requireNotNull(source.path))
      require(sourceFile.isFile && sourceFile.length() > 0L) { "JPEG file does not exist or is empty" }
      devLog("jpeg_exists")
      val validJpeg = try {
        sourceFile.inputStream().use { stream ->
          stream.read() == 0xFF && stream.read() == 0xD8 && stream.read() == 0xFF
        }
      } catch (_: Exception) {
        devLog("jpeg_read_failed", "reason=read_error")
        throw IllegalArgumentException("JPEG file could not be read")
      }
      require(validJpeg) { "file is not a valid JPEG" }
      devLog("jpeg_read_succeeded", "nonEmpty=true jpegSignature=true")
      val metaAppId = requireNotNull(
        configuredMetaAppId(context),
      ) { "Instagram Stories Meta App ID is not configured" }
      devLog("source_application_configured")
      val contentUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.SharingFileProvider",
        sourceFile,
      )
      val intent = Intent(STORIES_ACTION).apply {
        setDataAndType(contentUri, JPEG_MIME)
        setPackage(INSTAGRAM_PACKAGE)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        putExtra("source_application", metaAppId)
      }
      require(context.packageManager.resolveActivity(intent, 0) != null) {
        "Instagram Stories is unavailable"
      }
      devLog("intent_available")
      context.grantUriPermission(INSTAGRAM_PACKAGE, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      appContext.throwingActivity.startActivity(intent)
      devLog("intent_started")
    }
  }

  private fun configuredMetaAppId(context: Context): String? {
    val applicationInfo = context.packageManager.getApplicationInfo(
      context.packageName,
      PackageManager.GET_META_DATA,
    )
    val resourceId = applicationInfo.metaData?.getInt(META_APP_ID_KEY, 0) ?: 0
    val value = if (resourceId != 0) context.getString(resourceId).trim() else ""
    return value.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
  }
}
