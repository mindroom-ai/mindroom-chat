#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <node_api.h>

#include <cstring>
#include <memory>

namespace {

struct MonitorState {
  napi_env env = nullptr;
  napi_ref callback_ref = nullptr;
  napi_async_context async_context = nullptr;
  __weak NSWindow* window = nil;
  __strong id monitor = nil;
  bool in_touch_gesture = false;
  bool in_callback = false;
  bool detached = false;
  bool cleanup_registered = false;
  std::shared_ptr<MonitorState> keepalive;
};

void EnvCleanupHook(void* arg);

napi_value Throw(napi_env env, const char* msg, bool type_error = false) {
  (type_error ? napi_throw_type_error : napi_throw_error)(env, nullptr, msg);
  return nullptr;
}

void ReleaseNapi(MonitorState* s) {
  if (s->callback_ref) { napi_delete_reference(s->env, s->callback_ref); s->callback_ref = nullptr; }
  if (s->async_context) { napi_async_destroy(s->env, s->async_context); s->async_context = nullptr; }
  s->keepalive.reset();
}

void Detach(const std::shared_ptr<MonitorState>& s, bool from_cleanup) {
  if (s->detached) return;
  s->detached = true;
  s->in_touch_gesture = false;
  s->window = nil;
  if (s->monitor != nil) {
    id mon = s->monitor;
    s->monitor = nil;
    [NSEvent removeMonitor:mon];
  }
  if (s->cleanup_registered && !from_cleanup) {
    napi_remove_env_cleanup_hook(s->env, EnvCleanupHook, s.get());
  }
  s->cleanup_registered = false;
  if (!s->in_callback) ReleaseNapi(s.get());
}

void EnvCleanupHook(void* arg) {
  if (auto state = static_cast<MonitorState*>(arg)->keepalive) Detach(state, true);
}

void EmitPhase(const std::shared_ptr<MonitorState>& s, const char* phase) {
  if (s->detached || s->in_callback || !s->callback_ref) return;
  s->in_callback = true;
  napi_handle_scope scope = nullptr;
  if (napi_open_handle_scope(s->env, &scope) == napi_ok) {
    napi_value cb = nullptr, recv = nullptr, arg = nullptr;
    if (napi_get_reference_value(s->env, s->callback_ref, &cb) == napi_ok && cb &&
        napi_get_undefined(s->env, &recv) == napi_ok &&
        napi_create_string_utf8(s->env, phase, NAPI_AUTO_LENGTH, &arg) == napi_ok &&
        napi_make_callback(s->env, s->async_context, recv, cb, 1, &arg, nullptr) ==
            napi_pending_exception) {
      napi_value err = nullptr;
      if (napi_get_and_clear_last_exception(s->env, &err) == napi_ok) napi_fatal_exception(s->env, err);
    }
    napi_close_handle_scope(s->env, scope);
  }
  s->in_callback = false;
  if (s->detached) ReleaseNapi(s.get());
}

void HandleScrollEvent(const std::shared_ptr<MonitorState>& s, NSEvent* event) {
  NSWindow* w = s->window;
  if (w == nil || event.window != w) return;
  const NSEventPhase phase = event.phase;
  const NSEventPhase momentum = event.momentumPhase;
  CGEventRef cg = event.CGEvent;
  const BOOL is_hw_touch = event.hasPreciseScrollingDeltas && cg != nullptr &&
                           CGEventGetIntegerValueField(cg, kCGEventSourceUnixProcessID) == 0;
  if (phase == NSEventPhaseMayBegin) return;
  if (is_hw_touch && (phase == NSEventPhaseBegan || (phase == NSEventPhaseChanged && !s->in_touch_gesture))) {
    if (!s->in_touch_gesture) { s->in_touch_gesture = true; EmitPhase(s, "begin"); }
  } else if (phase == NSEventPhaseEnded) {
    if (s->in_touch_gesture) { s->in_touch_gesture = false; EmitPhase(s, "end"); }
  } else if (phase == NSEventPhaseCancelled) {
    if (s->in_touch_gesture) { s->in_touch_gesture = false; EmitPhase(s, "cancel"); }
  } else if (s->in_touch_gesture && momentum == NSEventPhaseNone &&
             (!is_hw_touch || phase == NSEventPhaseNone)) {
    s->in_touch_gesture = false;
    EmitPhase(s, "cancel");
  }
}

napi_value DetachCallback(napi_env env, napi_callback_info info) {
  void* data = nullptr;
  if (napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data) == napi_ok && data) {
    if (auto& state = *static_cast<std::shared_ptr<MonitorState>*>(data)) Detach(state, false);
  }
  napi_value undef = nullptr;
  napi_get_undefined(env, &undef);
  return undef;
}

void FinalizeDetach(napi_env, void* data, void*) {
  delete static_cast<std::shared_ptr<MonitorState>*>(data);
}

napi_value Attach(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return Throw(env, "attach must run on the macOS main thread");
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  bool is_buf = false;
  void* buf_data = nullptr;
  size_t buf_len = 0;
  napi_valuetype cb_type = napi_undefined;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 2)
    return Throw(env, "attach requires (nativeWindowHandle, onPhase)", true);
  if (napi_is_buffer(env, argv[0], &is_buf) != napi_ok || !is_buf ||
      napi_get_buffer_info(env, argv[0], &buf_data, &buf_len) != napi_ok ||
      !buf_data || buf_len != sizeof(void*))
    return Throw(env, "nativeWindowHandle must be a pointer-sized Buffer", true);
  if (napi_typeof(env, argv[1], &cb_type) != napi_ok || cb_type != napi_function)
    return Throw(env, "onPhase must be a function", true);

  void* raw_view = nullptr;
  std::memcpy(&raw_view, buf_data, sizeof(void*));
  if (!raw_view) return Throw(env, "nativeWindowHandle pointer is null");
  NSView* view = (__bridge NSView*)raw_view;
  NSWindow* target_window = view.window;
  if (target_window == nil) return Throw(env, "nativeWindowHandle has no attached NSWindow");

  auto state = std::make_shared<MonitorState>();
  state->env = env;
  state->window = target_window;
  napi_value resource_name = nullptr;
  if (napi_create_reference(env, argv[1], 1, &state->callback_ref) != napi_ok ||
      napi_create_string_utf8(env, "mindroom:trackpad-swipe", NAPI_AUTO_LENGTH, &resource_name) != napi_ok ||
      napi_async_init(env, nullptr, resource_name, &state->async_context) != napi_ok) {
    Detach(state, false);
    return Throw(env, "Failed to initialize N-API state");
  }

  std::weak_ptr<MonitorState> weak_state(state);
  state->monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
      handler:^NSEvent*(NSEvent* event) {
        if (auto s = weak_state.lock(); s && !s->detached) HandleScrollEvent(s, event);
        return event;
      }];
  if (state->monitor == nil || napi_add_env_cleanup_hook(env, EnvCleanupHook, state.get()) != napi_ok) {
    Detach(state, false);
    return Throw(env, "Failed to install NSEvent local monitor or cleanup hook");
  }
  state->cleanup_registered = true;

  auto* detach_handle = new std::shared_ptr<MonitorState>(state);
  napi_value detach_fn = nullptr;
  if (napi_create_function(env, "detach", NAPI_AUTO_LENGTH, DetachCallback, detach_handle, &detach_fn) != napi_ok ||
      napi_add_finalizer(env, detach_fn, detach_handle, FinalizeDetach, nullptr, nullptr) != napi_ok) {
    delete detach_handle;
    Detach(state, false);
    return Throw(env, "Failed to create detach callback");
  }
  state->keepalive = state;
  return detach_fn;
}

}  // namespace

extern "C" __attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1(void) {
  return NAPI_VERSION;
}

extern "C" __attribute__((visibility("default"))) napi_value napi_register_module_v1(
    napi_env env, napi_value exports) {
  napi_value attach_fn = nullptr;
  if (napi_create_function(env, "attach", NAPI_AUTO_LENGTH, Attach, nullptr, &attach_fn) != napi_ok ||
      napi_set_named_property(env, exports, "attach", attach_fn) != napi_ok)
    return nullptr;
  return exports;
}
