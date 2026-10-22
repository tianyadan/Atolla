#!/usr/bin/env ruby
# frozen_string_literal: true

# 把 AtollaIslandWidget Live Activity Extension 挂进 App.xcodeproj（幂等）
require 'xcodeproj'

ROOT = File.expand_path('..', __dir__)
PROJECT_PATH = File.join(ROOT, 'App', 'App.xcodeproj')
WIDGET_NAME = 'AtollaIslandWidget'
WIDGET_BUNDLE_ID = 'com.atolla.relay.AtollaIslandWidget'
TEAM = 'BB8WLWFV83'

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' }
abort('App target missing') unless app_target

app_group = project.main_group.children.find { |g| g.respond_to?(:name) && g.name == 'App' } ||
            project.main_group['App']
abort('App group missing') unless app_group

# —— 确保 App 源文件引用存在 ——
def ensure_file(group, filename)
  existing = group.files.find { |f| File.basename(f.path.to_s) == filename }
  return existing if existing

  group.new_file(filename)
end

attrs_ref = ensure_file(app_group, 'AtollaBusyAttributes.swift')
plugin_ref = ensure_file(app_group, 'AtollaIslandPlugin.swift')

# App target 加入插件源（若尚未加入）
[attrs_ref, plugin_ref].each do |ref|
  next if app_target.source_build_phase.files_references.include?(ref)

  app_target.add_file_references([ref])
end

if project.targets.any? { |t| t.name == WIDGET_NAME }
  puts "✓ #{WIDGET_NAME} already exists; App plugin sources ensured"
  project.save
  exit 0
end

# —— Widget 组与文件 ——
widget_group = project.main_group.new_group(WIDGET_NAME, WIDGET_NAME)
bundle_ref = widget_group.new_file('AtollaIslandWidgetBundle.swift')
live_ref = widget_group.new_file('AtollaBusyLiveActivity.swift')
_info_ref = widget_group.new_file('Info.plist')

# —— Widget Extension target ——
widget = project.new_target(:app_extension, WIDGET_NAME, :ios, '16.2')
widget.add_file_references([bundle_ref, live_ref, attrs_ref])

# Embed Foundation Extensions → PlugIns
plugins_dst = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
embed = app_target.copy_files_build_phases.find { |p| p.dst_subfolder_spec == plugins_dst || p.name == 'Embed Foundation Extensions' }
unless embed
  embed = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
  embed.name = 'Embed Foundation Extensions'
  embed.dst_subfolder_spec = plugins_dst
  app_target.build_phases << embed
end
# Avoid duplicate embed entries
unless embed.files_references.include?(widget.product_reference)
  build_file = embed.add_file_reference(widget.product_reference)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end
app_target.add_dependency(widget) unless app_target.dependencies.any? { |d| d.target == widget }

# Build settings
widget.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = WIDGET_BUNDLE_ID
  s['INFOPLIST_FILE'] = "#{WIDGET_NAME}/Info.plist"
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = TEAM
  s['SWIFT_VERSION'] = '5.0'
  s['MARKETING_VERSION'] = '1.0.3'
  s['CURRENT_PROJECT_VERSION'] = '3'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['LD_RUNPATH_SEARCH_PATHS'] = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  s['SKIP_INSTALL'] = 'YES'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
end

app_target.build_configurations.each do |config|
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
end
project.build_configurations.each do |config|
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
end

# TargetAttributes for signing
attrs = project.root_object.attributes['TargetAttributes'] ||= {}
attrs[widget.uuid] = {
  'CreatedOnToolsVersion' => '15.0',
  'ProvisioningStyle' => 'Automatic',
  'DevelopmentTeam' => TEAM
}

project.save
puts "✓ Added #{WIDGET_NAME} + wired AtollaIsland plugin sources"
