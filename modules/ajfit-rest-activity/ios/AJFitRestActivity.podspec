Pod::Spec.new do |s|
  s.name           = 'AJFitRestActivity'
  s.version        = '1.0.0'
  s.summary        = 'Native rest countdown presentation bridge for AJ Fit.'
  s.description    = 'Presents materialized AJ Fit rest deadlines with ActivityKit.'
  s.license        = { :type => 'MIT' }
  s.author         = 'AJ Fit'
  s.homepage       = 'https://ajfit.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
