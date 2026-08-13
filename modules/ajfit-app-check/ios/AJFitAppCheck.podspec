Pod::Spec.new do |s|
  s.name           = 'AJFitAppCheck'
  s.version        = '1.0.0'
  s.summary        = 'Minimal Firebase App Check bridge for AJ Fit.'
  s.description    = 'Exposes only a native App Check token and its official expiration.'
  s.license        = { :type => 'MIT' }
  s.author         = 'AJ Fit'
  s.homepage       = 'https://ajfit.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # FirebaseAppCheck 12.15+ resolves AppCheckCore 11.3, whose reCAPTCHA Swift
  # compatibility header is not exposed by Expo 56's static CocoaPods graph.
  # Keep this official, pre-reCAPTCHA pair pinned until that upstream CNG
  # integration compiles without a generated-Pods patch.
  s.dependency 'FirebaseAppCheck', '= 12.14.0'
  s.dependency 'AppCheckCore', '= 11.2.0'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
