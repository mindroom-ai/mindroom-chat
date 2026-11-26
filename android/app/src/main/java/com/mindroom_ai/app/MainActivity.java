package com.mindroom_ai.app;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.ProcessedRoute;
import com.getcapacitor.WebViewListener;

// Capacitor 8.6's SystemBars plugin handles viewport insets itself on onPageCommitVisible.
public class MainActivity extends BridgeActivity {

    private static final long RENDER_CRASH_WINDOW_MS = 15_000L;
    private static final int MAX_RENDER_RECOVERIES_IN_WINDOW = 2;
    private static final Object RENDER_RECOVERY_LOCK = new Object();
    private static long renderCrashWindowStartMs = -1L;
    private static int renderRecoveriesInWindow = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MindRoomFileSavePlugin.class);
        bridgeBuilder.setRouteProcessor((basePath, path) -> {
            ProcessedRoute route = new ProcessedRoute();
            String resolved = MindRoomRouteResolver.resolvePath(path);
            route.setPath((basePath == null ? "" : basePath) + (resolved == null ? "" : resolved));
            route.setAsset(true);
            route.setIgnoreAssetPath(false);
            return route;
        });
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
                if (isFinishing() || isDestroyed()) return true;
                if (!recordRenderProcessRecovery(SystemClock.elapsedRealtime())) {
                    Logger.error("WebView render process exited repeatedly (didCrash=" + didCrash + "); terminating");
                    return false;
                }
                Logger.warn("WebView render process gone (didCrash=" + didCrash + "); recreating activity");
                if (webView != null && webView.getParent() instanceof ViewGroup parent) {
                    parent.removeView(webView);
                }
                recreate();
                return true;
            }
        });
        super.onCreate(savedInstanceState);
        MindRoomNotificationChannels.ensureCreated(this);
    }

    static boolean recordRenderProcessRecovery(long nowMs) {
        synchronized (RENDER_RECOVERY_LOCK) {
            if (renderCrashWindowStartMs < 0L || nowMs < renderCrashWindowStartMs || nowMs - renderCrashWindowStartMs > RENDER_CRASH_WINDOW_MS) {
                renderCrashWindowStartMs = nowMs;
                renderRecoveriesInWindow = 1;
                return true;
            }
            if (renderRecoveriesInWindow >= MAX_RENDER_RECOVERIES_IN_WINDOW) return false;
            renderRecoveriesInWindow++;
            return true;
        }
    }
}
