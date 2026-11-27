package com.mindroom_ai.app;

import android.content.Context;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MindRoomPushConfig")
public class MindRoomPushConfigPlugin extends Plugin {

    static final String CONFIGURED_KEY = "configured";
    static final String ENABLED_KEY = "enabled";

    static boolean isFcmConfigured() {
        return BuildConfig.MINDROOM_FCM_CONFIGURED;
    }

    static boolean resolveNotificationsEnabled(Context context) {
        if (context == null) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put(CONFIGURED_KEY, isFcmConfigured());
        call.resolve(result);
    }

    @PluginMethod
    public void areNotificationsEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put(ENABLED_KEY, resolveNotificationsEnabled(getContext()));
        call.resolve(result);
    }
}
