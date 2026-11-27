package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class MindRoomPushConfigPluginTest {

    @Test
    public void exposesBuildConfigFcmConfiguredFlag() {
        assertEquals("configured", MindRoomPushConfigPlugin.CONFIGURED_KEY);
        assertEquals("enabled", MindRoomPushConfigPlugin.ENABLED_KEY);
        assertEquals(BuildConfig.MINDROOM_FCM_CONFIGURED, MindRoomPushConfigPlugin.isFcmConfigured());
    }

    @Test
    public void resolveNotificationsEnabledFailsClosedOnNullContext() {
        assertFalse(MindRoomPushConfigPlugin.resolveNotificationsEnabled(null));
    }
}
