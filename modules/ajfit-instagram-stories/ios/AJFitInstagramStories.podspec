Pod::Spec.new do |s|
  s.name           = 'AJFitInstagramStories'
  s.version        = '1.0.0'
  s.summary        = 'Public Instagram Stories image handoff for AJ Fit.'
  s.description    = 'Hands an AJ Fit JPEG to Instagram Stories using its documented pasteboard contract.'
  s.license        = { :type => 'MIT' }
  s.author         = 'AJ Fit'
  s.homepage       = 'https://ajfit.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'Photos'
  s.source_files = '**/*.{h,m,swift}'
end
