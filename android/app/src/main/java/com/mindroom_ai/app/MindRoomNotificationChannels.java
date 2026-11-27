package com.mindroom_ai.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import java.util.List;

final class MindRoomNotificationChannels {

    static final String MESSAGES_CHANNEL_ID = "mindroom_messages";
    static final String CHANNEL_MESSAGES_SILENT = "mindroom_messages_silent";
    static final String CALLS_CHANNEL_ID = "mindroom_calls";
    static final String ACTIVE_CALL_CHANNEL_ID = "mindroom_active_call";

    static final class ChannelSpec {

        final String id;
        final String name;
        final int importance;
        final boolean silent;

        ChannelSpec(String id, String name, int importance, boolean silent) {
            this.id = id;
            this.name = name;
            this.importance = importance;
            this.silent = silent;
        }
    }

    private static final List<ChannelSpec> CHANNEL_SPECS = List.of(
        new ChannelSpec(MESSAGES_CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH, false),
        new ChannelSpec(CHANNEL_MESSAGES_SILENT, "Silent messages", NotificationManager.IMPORTANCE_LOW, true),
        new ChannelSpec(CALLS_CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH, false),
        new ChannelSpec(ACTIVE_CALL_CHANNEL_ID, "Active call", NotificationManager.IMPORTANCE_LOW, true)
    );

    private MindRoomNotificationChannels() {}

    static List<ChannelSpec> getChannelSpecs() {
        return CHANNEL_SPECS;
    }

    static void ensureCreated(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        for (ChannelSpec spec : CHANNEL_SPECS) {
            NotificationChannel channel = new NotificationChannel(spec.id, spec.name, spec.importance);
            if (spec.silent) {
                channel.setSound(null, null);
                channel.enableVibration(false);
            }
            manager.createNotificationChannel(channel);
        }
    }
}
