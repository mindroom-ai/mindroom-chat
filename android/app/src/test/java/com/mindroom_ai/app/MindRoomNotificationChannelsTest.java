package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.Test;

public class MindRoomNotificationChannelsTest {

    @Test
    public void definesMessagesSilentMessagesCallsAndActiveCallChannels() {
        List<MindRoomNotificationChannels.ChannelSpec> specs = MindRoomNotificationChannels.getChannelSpecs();
        assertEquals(4, specs.size());

        MindRoomNotificationChannels.ChannelSpec messages = specs.get(0);
        assertEquals("mindroom_messages", messages.id);
        assertEquals(MindRoomNotificationChannels.MESSAGES_CHANNEL_ID, messages.id);
        assertEquals("Messages", messages.name);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, messages.importance);
        assertFalse(messages.silent);

        MindRoomNotificationChannels.ChannelSpec silentMessages = specs.get(1);
        assertEquals("mindroom_messages_silent", silentMessages.id);
        assertEquals(MindRoomNotificationChannels.CHANNEL_MESSAGES_SILENT, silentMessages.id);
        assertEquals("Silent messages", silentMessages.name);
        assertEquals(NotificationManager.IMPORTANCE_LOW, silentMessages.importance);
        assertTrue(silentMessages.silent);

        MindRoomNotificationChannels.ChannelSpec calls = specs.get(2);
        assertEquals("mindroom_calls", calls.id);
        assertEquals(MindRoomNotificationChannels.CALLS_CHANNEL_ID, calls.id);
        assertEquals("Incoming calls", calls.name);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, calls.importance);
        assertFalse(calls.silent);

        MindRoomNotificationChannels.ChannelSpec activeCall = specs.get(3);
        assertEquals("mindroom_active_call", activeCall.id);
        assertEquals(MindRoomNotificationChannels.ACTIVE_CALL_CHANNEL_ID, activeCall.id);
        assertEquals("Active call", activeCall.name);
        assertEquals(NotificationManager.IMPORTANCE_LOW, activeCall.importance);
        assertTrue(activeCall.silent);
    }

    @Test
    public void channelIdsAreUniqueAndNonBlank() {
        Set<String> seen = new HashSet<>();
        for (MindRoomNotificationChannels.ChannelSpec spec : MindRoomNotificationChannels.getChannelSpecs()) {
            assertFalse(spec.id == null || spec.id.trim().isEmpty());
            assertFalse(spec.name == null || spec.name.trim().isEmpty());
            assertTrue("Duplicate channel ID: " + spec.id, seen.add(spec.id));
        }
    }

    @Test
    public void ensureCreatedHandlesNullContextSafely() {
        MindRoomNotificationChannels.ensureCreated(null);
    }
}
