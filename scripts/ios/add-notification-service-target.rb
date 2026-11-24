# Adds the iOS Notification Service Extension to ios/App/App.xcodeproj: the app extension target
# MindRoomNotificationService, the local Swift package MindRoomNotificationKit (linked to both
# MindRoomNotificationService and the iOS slice of App), MindRoomNotificationsPlugin.swift on the
# iOS slice of App, and an "Embed Foundation Extensions" phase in App. Run once with the xcodeproj
# gem (the version CocoaPods brings); the result is committed. The extension reads its sources from
# the synchronized folder ios/NotificationService/MindRoomNotificationService, so new files need no
# second run. A project that has the target already is left as it is (except ensuring the embed
# phase stays before post-build script phases to avoid an Xcode build cycle).
require 'xcodeproj'

repo = File.expand_path('../..', __dir__)
project_path = File.join(repo, 'ios/App/App.xcodeproj')
project = Xcodeproj::Project.open(project_path)

app = project.targets.find { |target| target.name == 'App' }
raise 'App target not found' unless app

def position_embed_phase_after_resources(app, embed_phase)
  resources_index = app.build_phases.index(app.resources_build_phase)
  return false unless resources_index

  current_index = app.build_phases.index(embed_phase)
  desired_index = resources_index + 1
  return false if current_index == desired_index

  app.build_phases.delete(embed_phase)
  resources_index = app.build_phases.index(app.resources_build_phase)
  app.build_phases.insert(resources_index + 1, embed_phase)
  true
end

if project.targets.any? { |target| target.name == 'MindRoomNotificationService' }
  embed_extensions = app.copy_files_build_phases.find { |phase| phase.name == 'Embed Foundation Extensions' }
  if embed_extensions && position_embed_phase_after_resources(app, embed_extensions)
    project.save
    puts 'Repositioned Embed Foundation Extensions before script phases'
  else
    puts 'MindRoomNotificationService is already in the project'
  end
  exit 0
end

app_group = project.main_group.children.find { |child| child.isa == 'PBXGroup' && child.path == 'App' }
raise 'App group not found' unless app_group

app_settings = app.build_configurations.first.build_settings
IOS_DEPLOYMENT_TARGET = '16.4'

# Synchronized folders need the Xcode 16 project format.
project.root_object.compatibility_version = 'Xcode 16.0'
project.instance_variable_set(:@object_version, '77')

# Add MindRoomNotificationsPlugin.swift to the iOS build of App.
plugin_ref = app_group.files.find { |file| file.path == 'MindRoomNotificationsPlugin.swift' } ||
             app_group.new_file('MindRoomNotificationsPlugin.swift')
unless app.source_build_phase.files_references.include?(plugin_ref)
  plugin_build_file = app.source_build_phase.add_file_reference(plugin_ref)
  plugin_build_file.platform_filter = 'ios'
end

notification_group = project.main_group.children.find { |g| g.isa == 'PBXGroup' && g.name == 'NotificationService' } ||
                     project.main_group.new_group('NotificationService', '../NotificationService')

def synced_folder(project, group, path)
  folder = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup)
  folder.path = path
  folder.source_tree = '<group>'
  group.children << folder
  folder
end

def local_package(project, relative_path, product)
  reference = project.root_object.package_references.find do |r|
    r.respond_to?(:relative_path) && r.relative_path == relative_path
  end
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

def link_package(project, target, dependency, platform_filter: nil)
  target.package_product_dependencies << dependency
  file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  file.product_ref = dependency
  file.platform_filter = platform_filter if platform_filter
  target.frameworks_build_phase.files << file
end

service = project.new_target(:app_extension, 'MindRoomNotificationService', :ios, IOS_DEPLOYMENT_TARGET)
service.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'chat.mindroom.app.NotificationService',
    'PRODUCT_NAME' => 'MindRoomNotificationService',
    'CODE_SIGN_ENTITLEMENTS' => '../NotificationService/MindRoomNotificationService/MindRoomNotificationService.entitlements',
    'INFOPLIST_FILE' => '../NotificationService/MindRoomNotificationService/Info.plist',
    'SKIP_INSTALL' => 'YES',
    'CODE_SIGN_STYLE' => 'Automatic',
    'DEVELOPMENT_TEAM' => app_settings['DEVELOPMENT_TEAM'],
    'MARKETING_VERSION' => app_settings['MARKETING_VERSION'],
    'CURRENT_PROJECT_VERSION' => app_settings['CURRENT_PROJECT_VERSION'],
    'IPHONEOS_DEPLOYMENT_TARGET' => IOS_DEPLOYMENT_TARGET,
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SWIFT_VERSION' => '5.0',
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'NO',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => config.name == 'Debug' ? 'DEBUG' : ''
  )
end

service_folder = synced_folder(project, notification_group, 'MindRoomNotificationService')
service.file_system_synchronized_groups << service_folder
# Info.plist is the target's Info.plist file, not a resource to copy.
exception = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedBuildFileExceptionSet)
exception.target = service
exception.membership_exceptions = ['Info.plist']
service_folder.exceptions << exception

link_package(
  project,
  service,
  local_package(project, '../NotificationService/MindRoomNotificationKit', 'MindRoomNotificationKit')
)
link_package(
  project,
  app,
  local_package(project, '../NotificationService/MindRoomNotificationKit', 'MindRoomNotificationKit'),
  platform_filter: 'ios'
)

# Embed the iOS Notification Service Extension in the iOS app.
app.add_dependency(service)
app.dependencies.find { |dependency| dependency.target == service }.platform_filter = 'ios'

embed_extensions = app.copy_files_build_phases.find { |phase| phase.name == 'Embed Foundation Extensions' } ||
                   app.new_copy_files_build_phase('Embed Foundation Extensions')
embed_extensions.symbol_dst_subfolder_spec = :plug_ins
embedded = embed_extensions.add_file_reference(service.product_reference)
embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
embedded.platform_filter = 'ios'

# Place before post-build script phases to prevent an Xcode cycle.
position_embed_phase_after_resources(app, embed_extensions)

project.save
puts 'Added MindRoomNotificationService'
