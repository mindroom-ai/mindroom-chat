package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class MindRoomPushConfigPluginTest {

    @Test
    public void exposesBuildConfigFcmConfiguredFlag() {
        assertEquals("configured", MindRoomPushConfigPlugin.CONFIGURED_KEY);
        assertEquals(BuildConfig.MINDROOM_FCM_CONFIGURED, MindRoomPushConfigPlugin.isFcmConfigured());
    }
}
