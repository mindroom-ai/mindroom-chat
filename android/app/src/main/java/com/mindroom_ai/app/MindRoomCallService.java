package com.mindroom_ai.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.getcapacitor.Logger;

/**
 * Keeps voice and video calls alive while MindRoom is backgrounded on Android by holding a
 * microphone-typed foreground service with an ongoing silent notification.
 */
public class MindRoomCallService extends Service {

    static final String ACTION_START = "com.mindroom_ai.app.action.START_CALL_SERVICE";
    static final String EXTRA_ROOM_NAME = "room_name";
    static final int NOTIFICATION_ID = 4101;
    static final String DEFAULT_TITLE = "MindRoom call in progress";
    static final String CALL_TITLE_PREFIX = "Call in ";
    static final String DEFAULT_CONTENT_TEXT = "Tap to return to the call";
    static final int MAX_ROOM_NAME_LENGTH = 80;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MindRoomNotificationChannels.ensureCreated(this);
        String roomName = intent != null ? intent.getStringExtra(EXTRA_ROOM_NAME) : null;
        Notification notification = buildNotification(roomName);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            Logger.warn("MindRoomCallService failed to enter foreground: " + e.getMessage());
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildNotification(String roomName) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_MAIN);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, MindRoomNotificationChannels.ACTIVE_CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(formatNotificationTitle(roomName))
            .setContentText(formatNotificationText())
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .build();
    }

    static String sanitizeRoomName(String raw) {
        if (raw == null) {
            return null;
        }
        StringBuilder cleaned = new StringBuilder(raw.length());
        boolean lastWasSpace = true;
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (Character.isISOControl(c) || Character.isWhitespace(c)) {
                if (!lastWasSpace) {
                    cleaned.append(' ');
                    lastWasSpace = true;
                }
            } else {
                cleaned.append(c);
                lastWasSpace = false;
            }
        }
        int length = cleaned.length();
        while (length > 0 && cleaned.charAt(length - 1) == ' ') {
            length--;
        }
        if (length == 0) {
            return null;
        }
        if (length > MAX_ROOM_NAME_LENGTH) {
            return cleaned.substring(0, MAX_ROOM_NAME_LENGTH - 1).trim() + "…";
        }
        return cleaned.substring(0, length);
    }

    static String formatNotificationTitle(String roomName) {
        String sanitized = sanitizeRoomName(roomName);
        return sanitized != null ? CALL_TITLE_PREFIX + sanitized : DEFAULT_TITLE;
    }

    static String formatNotificationText() {
        return DEFAULT_CONTENT_TEXT;
    }

    static boolean requiresRecordAudioPermission(int sdkInt) {
        return sdkInt >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
    }

    static boolean canStartMicrophoneForegroundService(int sdkInt, boolean hasRecordAudioPermission) {
        return !requiresRecordAudioPermission(sdkInt) || hasRecordAudioPermission;
    }
}
