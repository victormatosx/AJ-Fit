Pod::Spec.new do |s|
  s.name           = 'AJFitWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Shared-storage bridge for AJ Fit Home Screen Widgets.'
  s.description    = 'Persists a pre-resolved WidgetSnapshotV1 JSON blob into the widgets App Group container. No business logic.'
  s.license        = { :type => 'MIT' }
  s.author         = 'AJ Fit'
  s.homepage       = 'https://ajfit.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
