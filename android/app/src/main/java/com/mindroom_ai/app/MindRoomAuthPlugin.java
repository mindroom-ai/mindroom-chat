package com.mindroom_ai.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Android counterpart to iOS MindRoomAuthPlugin: launches SSO and Cloudflare Access sign-in flows
 * in Chrome Custom Tabs and resolves the calling Promise when the app receives the matching custom
 * scheme callback intent.
 */
@CapacitorPlugin(name = "MindRoomAuth")
public class MindRoomAuthPlugin extends Plugin {

    private static final long CANCEL_GRACE_MS = 350L;
    private static final Pattern SCHEME_PATTERN = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*$");

    static final class PendingSession<T> {

        final T call;
        final String callbackScheme;
        boolean launched;
        boolean paused;

        PendingSession(T call, String callbackScheme) {
            this.call = call;
            this.callbackScheme = callbackScheme;
        }
    }

    static final class AuthSessionTracker<T> {

        private PendingSession<T> pending;

        synchronized boolean hasPending() {
            return pending != null;
        }

        synchronized PendingSession<T> begin(T call, String callbackScheme) {
            if (pending != null) {
                return null;
            }
            pending = new PendingSession<>(call, callbackScheme);
            return pending;
        }

        synchronized void markLaunched(PendingSession<T> session) {
            if (pending == session) {
                pending.launched = true;
            }
        }

        synchronized void markPaused() {
            if (pending != null && pending.launched) {
                pending.paused = true;
            }
        }

        synchronized PendingSession<T> getResumeCancellationCandidate() {
            if (pending != null && pending.launched && pending.paused) {
                return pending;
            }
            return null;
        }

        synchronized T completeIfMatching(String incomingUrl) {
            if (pending == null || !matchesCallbackScheme(pending.callbackScheme, incomingUrl)) {
                return null;
            }
            T call = pending.call;
            pending = null;
            return call;
        }

        synchronized T cancelIfCurrent(PendingSession<T> expected) {
            if (pending == null || (expected != null && pending != expected)) {
                return null;
            }
            T call = pending.call;
            pending = null;
            return call;
        }
    }

    private final AuthSessionTracker<PluginCall> tracker = new AuthSessionTracker<>();
    private Handler mainHandler;
    private Runnable pendingCancelRunnable;

    private synchronized Handler getMainHandler() {
        if (mainHandler == null) {
            mainHandler = new Handler(Looper.getMainLooper());
        }
        return mainHandler;
    }

    private synchronized void clearPendingCancel() {
        if (pendingCancelRunnable != null && mainHandler != null) {
            mainHandler.removeCallbacks(pendingCancelRunnable);
        }
        pendingCancelRunnable = null;
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        String rawUrl = call.getString("url");
        if (!isValidHttpUrl(rawUrl)) {
            call.reject("Must provide an HTTP(S) authentication URL", "INVALID_URL");
            return;
        }

        String callbackScheme = normalizeCallbackScheme(call.getString("callbackScheme"));
        if (callbackScheme == null) {
            call.reject("Must provide a valid callback URL scheme", "INVALID_CALLBACK_SCHEME");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Unable to start authentication session", "AUTH_START_FAILED");
            return;
        }

        PendingSession<PluginCall> session = tracker.begin(call, callbackScheme);
        if (session == null) {
            call.reject("An authentication session is already in progress", "AUTH_IN_PROGRESS");
            return;
        }

        String trimmedUrl = rawUrl.trim();
        activity.runOnUiThread(() -> {
            try {
                tracker.markLaunched(session);
                CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder().build();
                customTabsIntent.launchUrl(activity, Uri.parse(trimmedUrl));
            } catch (RuntimeException e) {
                Logger.warn("MindRoomAuth unable to open Custom Tabs: " + e.getMessage());
                PluginCall failedCall = tracker.cancelIfCurrent(session);
                if (failedCall != null) {
                    failedCall.reject("Unable to start authentication session", "AUTH_START_FAILED");
                }
            }
        });
    }

    @PluginMethod
    public void signInWithApple(PluginCall call) {
        call.reject("Sign in with Apple is not supported on Android", "UNSUPPORTED");
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        if (data == null) {
            return;
        }

        String url = data.toString();
        PluginCall completedCall = tracker.completeIfMatching(url);
        if (completedCall != null) {
            clearPendingCancel();
            JSObject result = new JSObject();
            result.put("url", url);
            completedCall.resolve(result);
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        tracker.markPaused();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        PendingSession<PluginCall> candidate = tracker.getResumeCancellationCandidate();
        if (candidate == null) {
            return;
        }

        clearPendingCancel();
        Runnable cancelRunnable = () -> {
            PluginCall cancelledCall = tracker.cancelIfCurrent(candidate);
            if (cancelledCall != null) {
                cancelledCall.reject("Authentication cancelled", "AUTH_CANCELLED");
            }
        };
        synchronized (this) {
            pendingCancelRunnable = cancelRunnable;
        }
        getMainHandler().postDelayed(cancelRunnable, CANCEL_GRACE_MS);
    }

    @Override
    protected void handleOnDestroy() {
        clearPendingCancel();
        PluginCall pendingCall = tracker.cancelIfCurrent(null);
        if (pendingCall != null) {
            pendingCall.reject("Authentication cancelled", "AUTH_CANCELLED");
        }
    }

    static boolean isValidHttpUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return false;
        }
        try {
            URI uri = URI.create(rawUrl.trim());
            String scheme = uri.getScheme();
            if (scheme == null) {
                return false;
            }
            String normalized = scheme.toLowerCase(Locale.ROOT);
            return (
                ("http".equals(normalized) || "https".equals(normalized)) &&
                uri.getHost() != null &&
                !uri.getHost().isEmpty()
            );
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    static String normalizeCallbackScheme(String rawScheme) {
        if (rawScheme == null) {
            return null;
        }
        String trimmed = rawScheme.trim();
        if (trimmed.isEmpty() || !SCHEME_PATTERN.matcher(trimmed).matches()) {
            return null;
        }
        return trimmed.toLowerCase(Locale.ROOT);
    }

    static boolean matchesCallbackScheme(String callbackScheme, String incomingUrl) {
        String normalizedExpected = normalizeCallbackScheme(callbackScheme);
        if (normalizedExpected == null || incomingUrl == null || incomingUrl.isEmpty()) {
            return false;
        }
        int colon = incomingUrl.indexOf(':');
        if (colon <= 0) {
            return false;
        }
        String incomingScheme = incomingUrl.substring(0, colon).toLowerCase(Locale.ROOT);
        return normalizedExpected.equals(incomingScheme);
    }
}
