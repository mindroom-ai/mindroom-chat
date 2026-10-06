# Run with the same Ruby/GEM_PATH as fastlane:
# ruby fastlane/tests/release_target_test.rb
require "minitest/autorun"
require "spaceship"

module UI
  def self.user_error!(message)
    raise ArgumentError, message
  end

  def self.success(_message); end
end

class ReleaseTargetTest < Minitest::Test
  def setup
    @lanes = {}
    lanes = @lanes
    @runner = Object.new
    @runner.define_singleton_method(:default_platform) { |_name| }
    @runner.define_singleton_method(:platform) { |_name, &block| instance_eval(&block) }
    @runner.define_singleton_method(:desc) { |_description| }
    @runner.define_singleton_method(:lane) { |_name, &_block| }
    @runner.define_singleton_method(:private_lane) { |name, &block| lanes[name] = block }
    @runner.instance_eval(File.read(File.expand_path("../Fastfile", __dir__)))

    @app = Object.new
    @app.define_singleton_method(:id) { "app-id" }
    @app.define_singleton_method(:get_in_progress_review_submission) { |**_options| nil }
    @app.define_singleton_method(:get_edit_app_store_version) { |**_options| nil }
    live = Struct.new(:version_string).new("4.12.320")
    @app.define_singleton_method(:get_live_app_store_version) { |**_options| live }
  end

  def with_stub(model, method, result)
    original = model.method(method)
    model.define_singleton_method(method) { |*_args, **_options| result }
    yield
  ensure
    model.define_singleton_method(method, original)
  end

  def verify(internal_state, processing_state: "VALID", expired: false)
    detail = Spaceship::ConnectAPI::BuildBetaDetail.new("build-id",
      "internalBuildState" => internal_state,
      "externalBuildState" => "READY_FOR_BETA_SUBMISSION",
    )
    build = Spaceship::ConnectAPI::Build.new("build-id",
      "processingState" => processing_state,
      "expired" => expired,
      "buildBetaDetail" => detail,
    )
    with_stub(Spaceship::ConnectAPI::App, :find, @app) do
      with_stub(Spaceship::ConnectAPI::Build, :all, [build]) do
        @runner.instance_exec(
          { app_version: "4.12.334", build_number: "328" },
          &@lanes.fetch(:verify_release_target)
        )
      end
    end
  end

  def test_accepts_a_build_ready_for_testflight
    verify("READY_FOR_BETA_TESTING")
  end

  def test_accepts_a_build_already_in_testflight
    verify("IN_BETA_TESTING")
  end

  def test_rejects_every_other_internal_state
    %w[PROCESSING PROCESSING_EXCEPTION MISSING_EXPORT_COMPLIANCE EXPIRED IN_EXPORT_COMPLIANCE_REVIEW].each do |state|
      error = assert_raises(ArgumentError) { verify(state) }
      assert_includes error.message, "not ready for testing or submission"
    end
    assert_raises(ArgumentError) { verify(nil) }
  end

  def test_still_rejects_invalid_and_expired_builds_already_in_testflight
    error = assert_raises(ArgumentError) { verify("IN_BETA_TESTING", processing_state: "INVALID") }
    assert_includes error.message, "not VALID"
    error = assert_raises(ArgumentError) { verify("IN_BETA_TESTING", expired: true) }
    assert_includes error.message, "expired"
  end
end
