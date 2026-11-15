# Adds the Apple Watch app to ios/App/App.xcodeproj: the watchOS app target MindRoomWatch, its
# WidgetKit extension MindRoomWatchWidgets, the local Swift packages MatrixRustSDK and
# MindRoomWatchKit, and an "Embed Watch Content" phase in the iPhone app. Run once with the
# xcodeproj gem (the version CocoaPods brings); the result is committed. The targets read their
# sources from synchronized folders (ios/Watch/MindRoomWatch, ios/Watch/MindRoomWatchWidgets), so
# new files need no second run. A project that has the targets already is left as it is.
require 'xcodeproj'

repo = File.expand_path('../..', __dir__)
project_path = File.join(repo, 'ios/App/App.xcodeproj')
project = Xcodeproj::Project.open(project_path)

if project.targets.any? { |target| target.name == 'MindRoomWatch' }
  puts 'MindRoomWatch is already in the project'
  exit 0
end

app = project.targets.find { |target| target.name == 'App' }
app_settings = app.build_configurations.first.build_settings
WATCHOS = '27.0'

# Synchronized folders need the Xcode 16 project format.
project.root_object.compatibility_version = 'Xcode 16.0'
project.instance_variable_set(:@object_version, '77')

watch_group = project.main_group.new_group('Watch', '../Watch')

def synced_folder(project, group, path)
  folder = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup)
  folder.path = path
  folder.source_tree = '<group>'
  group.children << folder
  folder
end

def local_package(project, relative_path, product)
  reference = project.root_object.package_references.find { |r| r.respond_to?(:relative_path) && r.relative_path == relative_path }
  unless reference
    reference = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
    reference.relative_path = relative_path
    project.root_object.package_references << reference
  end
  dependency = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dependency.package = reference
  dependency.product_name = product
  dependency
end

def link_package(project, target, dependency)
  target.package_product_dependencies << dependency
  file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  file.product_ref = dependency
  target.frameworks_build_phase.files << file
end

common = {
  'SWIFT_VERSION' => '5.0',
  'WATCHOS_DEPLOYMENT_TARGET' => WATCHOS,
  'SDKROOT' => 'watchos',
  'TARGETED_DEVICE_FAMILY' => '4',
  'ARCHS' => 'arm64',
  'DEVELOPMENT_TEAM' => app_settings['DEVELOPMENT_TEAM'],
  'CODE_SIGN_STYLE' => 'Automatic',
  'MARKETING_VERSION' => app_settings['MARKETING_VERSION'],
  'CURRENT_PROJECT_VERSION' => app_settings['CURRENT_PROJECT_VERSION'],
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'INFOPLIST_KEY_CFBundleDisplayName' => 'MindRoom',
  'SWIFT_EMIT_LOC_STRINGS' => 'YES',
  'ENABLE_USER_SCRIPT_SANDBOXING' => 'NO',
}

watch = project.new_target(:application, 'MindRoomWatch', :watchos, WATCHOS)
widgets = project.new_target(:app_extension, 'MindRoomWatchWidgets', :watchos, WATCHOS)

watch.build_configurations.each do |config|
  config.build_settings.merge!(common).merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'chat.mindroom.app.watchkitapp',
    'PRODUCT_NAME' => 'MindRoomWatch',
    'CODE_SIGN_ENTITLEMENTS' => '../Watch/MindRoomWatch/MindRoomWatch.entitlements',
    'INFOPLIST_FILE' => '../Watch/MindRoomWatch/Info.plist',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => 'chat.mindroom.app',
    'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp' => 'YES',
    'INFOPLIST_KEY_NSMicrophoneUsageDescription' => 'MindRoom records the voice messages you send.',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations' => 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => config.name == 'Debug' ? 'DEBUG' : '',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks'
  )
end
widgets.build_configurations.each do |config|
  config.build_settings.merge!(common).merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'chat.mindroom.app.watchkitapp.widgets',
    'PRODUCT_NAME' => 'MindRoomWatchWidgets',
    'CODE_SIGN_ENTITLEMENTS' => '../Watch/MindRoomWatchWidgets/MindRoomWatchWidgets.entitlements',
    'INFOPLIST_FILE' => '../Watch/MindRoomWatchWidgets/Info.plist',
    'SKIP_INSTALL' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  )
end

watch_folder = synced_folder(project, watch_group, 'MindRoomWatch')
watch.file_system_synchronized_groups << watch_folder
widget_folder = synced_folder(project, watch_group, 'MindRoomWatchWidgets')
widgets.file_system_synchronized_groups << widget_folder
# Each Info.plist is its target's Info.plist file, not a resource to copy.
[[watch_folder, watch], [widget_folder, widgets]].each do |folder, target|
  exception = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedBuildFileExceptionSet)
  exception.target = target
  exception.membership_exceptions = ['Info.plist']
  folder.exceptions << exception
end

link_package(project, watch, local_package(project, '../Watch/MatrixRustSDK', 'MatrixRustSDK'))
link_package(project, watch, local_package(project, '../Watch/MindRoomWatchKit', 'MindRoomWatchKit'))
link_package(project, widgets, local_package(project, '../Watch/MindRoomWatchKit', 'MindRoomWatchKit'))

# The widget extension inside the watch app, the watch app inside the iPhone app.
watch.add_dependency(widgets)
embed_widgets = watch.new_copy_files_build_phase('Embed Foundation Extensions')
embed_widgets.symbol_dst_subfolder_spec = :plug_ins
embed_widgets.add_file_reference(widgets.product_reference).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# The iPhone only: the Mac build of the app (Mac Catalyst) has no watch app.
app.add_dependency(watch)
app.dependencies.find { |dependency| dependency.target == watch }.platform_filter = 'ios'
embed_watch = app.new_copy_files_build_phase('Embed Watch Content')
embed_watch.dst_subfolder_spec = '16'
embed_watch.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
embedded = embed_watch.add_file_reference(watch.product_reference)
embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
embedded.platform_filter = 'ios'

project.save
puts 'Added MindRoomWatch and MindRoomWatchWidgets'
