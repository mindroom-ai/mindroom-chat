package com.mindroom_ai.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MindRoomCall")
public class MindRoomCallPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            resolveActive(call, false);
            return;
        }

        boolean hasRecordAudio =
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (!MindRoomCallService.canStartMicrophoneForegroundService(Build.VERSION.SDK_INT, hasRecordAudio)) {
            Logger.warn("MindRoomCall skipping foreground service: RECORD_AUDIO permission not granted");
            resolveActive(call, false);
            return;
        }

        Intent intent = new Intent(context, MindRoomCallService.class);
        intent.setAction(MindRoomCallService.ACTION_START);
        String sanitizedRoomName = MindRoomCallService.sanitizeRoomName(call.getString("roomName"));
        if (sanitizedRoomName != null) {
            intent.putExtra(MindRoomCallService.EXTRA_ROOM_NAME, sanitizedRoomName);
        }

        try {
            ContextCompat.startForegroundService(context, intent);
            resolveActive(call, true);
        } catch (SecurityException | IllegalStateException e) {
            Logger.warn("MindRoomCall unable to start foreground service: " + e.getMessage());
            resolveActive(call, false);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopCallService();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopCallService();
    }

    private void stopCallService() {
        Context context = getContext();
        if (context == null) {
            return;
        }
        try {
            context.stopService(new Intent(context, MindRoomCallService.class));
        } catch (RuntimeException e) {
            Logger.warn("MindRoomCall unable to stop foreground service: " + e.getMessage());
        }
    }

    private static void resolveActive(PluginCall call, boolean active) {
        JSObject result = new JSObject();
        result.put("active", active);
        call.resolve(result);
    }
}
