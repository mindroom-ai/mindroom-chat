package com.mindroom_ai.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MindRoomPushConfig")
public class MindRoomPushConfigPlugin extends Plugin {

    static final String CONFIGURED_KEY = "configured";

    static boolean isFcmConfigured() {
        return BuildConfig.MINDROOM_FCM_CONFIGURED;
    }

    @PluginMethod
    public void isConfigured(PluginCall call) {
        JSObject result = new JSObject();
        result.put(CONFIGURED_KEY, isFcmConfigured());
        call.resolve(result);
    }
}
