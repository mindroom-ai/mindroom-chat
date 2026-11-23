# Adds the iOS ReplayKit Broadcast Upload Extension to ios/App/App.xcodeproj: the app extension
# target MindRoomBroadcast, the pinned LiveKit Swift SDK remote package (linked to
# MindRoomBroadcast and the iOS slice of App only — never Mac Catalyst or AppStoreMac),
# MindRoomScreenSharePlugin.swift on the iOS slice of App, and an "Embed Foundation Extensions"
# entry in App. Run once with the xcodeproj gem; the result is committed. The extension reads its
# sources from the synchronized folder ios/BroadcastExtension/MindRoomBroadcast. Re-running on a
# project that already has the target exits 0 (ensuring the embed phase stays right after
# resources).
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

if project.targets.any? { |target| target.name == 'MindRoomBroadcast' }
  embed_extensions = app.copy_files_build_phases.find { |phase| phase.name == 'Embed Foundation Extensions' }
  if embed_extensions && position_embed_phase_after_resources(app, embed_extensions)
    project.save
    puts 'Repositioned Embed Foundation Extensions before script phases'
  else
    puts 'MindRoomBroadcast is already in the project'
  end
  exit 0
end

app_group = project.main_group.children.find { |child| child.isa == 'PBXGroup' && child.path == 'App' }
raise 'App group not found' unless app_group

app_settings = app.build_configurations.first.build_settings
IOS_DEPLOYMENT_TARGET = '16.4'
LIVEKIT_REPO_URL = 'https://github.com/livekit/client-sdk-swift.git'
LIVEKIT_VERSION = '2.19.0'

# Synchronized folders need the Xcode 16 project format.
project.root_object.compatibility_version = 'Xcode 16.0'
project.instance_variable_set(:@object_version, '77')

# Add MindRoomScreenSharePlugin.swift to the iOS build of App (skipped on Mac Catalyst).
plugin_ref = app_group.files.find { |file| file.path == 'MindRoomScreenSharePlugin.swift' } ||
             app_group.new_file('MindRoomScreenSharePlugin.swift')
unless app.source_build_phase.files_references.include?(plugin_ref)
  plugin_build_file = app.source_build_phase.add_file_reference(plugin_ref)
  plugin_build_file.platform_filter = 'ios'
end

broadcast_group = project.main_group.children.find { |g| g.isa == 'PBXGroup' && g.name == 'BroadcastExtension' } ||
                  project.main_group.new_group('BroadcastExtension', '../BroadcastExtension')

def synced_folder(project, group, path)
  folder = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup)
  folder.path = path
  folder.source_tree = '<group>'
  group.children << folder
  folder
end

def remote_package(project, repository_url, version, product)
  reference = project.root_object.package_references.find do |r|
    r.respond_to?(:repositoryURL) && r.repositoryURL == repository_url
  end
  unless reference
    reference = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
    reference.repositoryURL = repository_url
    reference.requirement = { 'kind' => 'exactVersion', 'version' => version }
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

broadcast = project.new_target(:app_extension, 'MindRoomBroadcast', :ios, IOS_DEPLOYMENT_TARGET)
broadcast.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'chat.mindroom.app.broadcast',
    'PRODUCT_NAME' => 'MindRoomBroadcast',
    'CODE_SIGN_ENTITLEMENTS' => '../BroadcastExtension/MindRoomBroadcast/MindRoomBroadcast.entitlements',
    'INFOPLIST_FILE' => '../BroadcastExtension/MindRoomBroadcast/Info.plist',
    'APPLICATION_EXTENSION_API_ONLY' => 'YES',
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

broadcast_folder = synced_folder(project, broadcast_group, 'MindRoomBroadcast')
broadcast.file_system_synchronized_groups << broadcast_folder
# Info.plist is the target's Info.plist file, not a resource to copy.
exception = project.new(Xcodeproj::Project::Object::PBXFileSystemSynchronizedBuildFileExceptionSet)
exception.target = broadcast
exception.membership_exceptions = ['Info.plist']
broadcast_folder.exceptions << exception

link_package(
  project,
  broadcast,
  remote_package(project, LIVEKIT_REPO_URL, LIVEKIT_VERSION, 'LiveKit')
)
link_package(
  project,
  app,
  remote_package(project, LIVEKIT_REPO_URL, LIVEKIT_VERSION, 'LiveKit'),
  platform_filter: 'ios'
)

# iOS only: Mac Catalyst and AppStoreMac do not embed the iOS Broadcast Upload Extension.
app.add_dependency(broadcast)
app.dependencies.find { |dependency| dependency.target == broadcast }.platform_filter = 'ios'

embed_extensions = app.copy_files_build_phases.find { |phase| phase.name == 'Embed Foundation Extensions' } ||
                   app.new_copy_files_build_phase('Embed Foundation Extensions')
embed_extensions.symbol_dst_subfolder_spec = :plug_ins
embedded = embed_extensions.add_file_reference(broadcast.product_reference)
embedded.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
embedded.platform_filter = 'ios'

# Place before post-build script phases (e.g. "Add the updater's Info.plist keys") to prevent an Xcode cycle.
position_embed_phase_after_resources(app, embed_extensions)

project.save
puts 'Added MindRoomBroadcast'