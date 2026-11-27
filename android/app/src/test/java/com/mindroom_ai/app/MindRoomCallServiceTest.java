package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import org.junit.Test;

public class MindRoomCallServiceTest {

    @Test
    public void sanitizeRoomNameTrimsCollapsesWhitespaceAndStripsControls() {
        assertEquals("Engineering Standup", MindRoomCallService.sanitizeRoomName("  Engineering   Standup  "));
        assertEquals("General Chat", MindRoomCallService.sanitizeRoomName("General\r\n\tChat\u0000"));
        assertEquals("Design", MindRoomCallService.sanitizeRoomName("Design"));
        assertNull(MindRoomCallService.sanitizeRoomName(null));
        assertNull(MindRoomCallService.sanitizeRoomName(""));
        assertNull(MindRoomCallService.sanitizeRoomName("   \r\n\t  "));
        assertNull(MindRoomCallService.sanitizeRoomName("\u0000\u0007"));
    }

    @Test
    public void sanitizeRoomNameTruncatesOverlongNamesWithEllipsis() {
        String exact = "a".repeat(MindRoomCallService.MAX_ROOM_NAME_LENGTH);
        assertEquals(exact, MindRoomCallService.sanitizeRoomName(exact));

        String overlong = "b".repeat(MindRoomCallService.MAX_ROOM_NAME_LENGTH + 15);
        String truncated = MindRoomCallService.sanitizeRoomName(overlong);
        assertEquals(MindRoomCallService.MAX_ROOM_NAME_LENGTH, truncated.length());
        assertTrue(truncated.endsWith("…"));
    }

    @Test
    public void formatNotificationCopyUsesRoomNameOrFallback() {
        assertEquals("Call in Team Room", MindRoomCallService.formatNotificationTitle("  Team\nRoom "));
        assertEquals(MindRoomCallService.DEFAULT_TITLE, MindRoomCallService.formatNotificationTitle(null));
        assertEquals(MindRoomCallService.DEFAULT_TITLE, MindRoomCallService.formatNotificationTitle("   "));
        assertEquals("Tap to open MindRoom", MindRoomCallService.formatNotificationText());
    }

    @Test
    public void microphonePermissionGuardAppliesOnAndroid14AndAbove() {
        assertFalse(MindRoomCallService.requiresRecordAudioPermission(Build.VERSION_CODES.N));
        assertFalse(MindRoomCallService.requiresRecordAudioPermission(Build.VERSION_CODES.R));
        assertFalse(MindRoomCallService.requiresRecordAudioPermission(Build.VERSION_CODES.TIRAMISU));
        assertTrue(MindRoomCallService.requiresRecordAudioPermission(Build.VERSION_CODES.UPSIDE_DOWN_CAKE));
        assertTrue(MindRoomCallService.requiresRecordAudioPermission(Build.VERSION_CODES.UPSIDE_DOWN_CAKE + 2));

        // API < 34: allowed even without runtime RECORD_AUDIO check.
        assertTrue(MindRoomCallService.canStartMicrophoneForegroundService(Build.VERSION_CODES.TIRAMISU, false));
        assertTrue(MindRoomCallService.canStartMicrophoneForegroundService(Build.VERSION_CODES.TIRAMISU, true));

        // API 34+: requires RECORD_AUDIO permission to avoid SecurityException.
        assertFalse(
            MindRoomCallService.canStartMicrophoneForegroundService(Build.VERSION_CODES.UPSIDE_DOWN_CAKE, false)
        );
        assertTrue(
            MindRoomCallService.canStartMicrophoneForegroundService(Build.VERSION_CODES.UPSIDE_DOWN_CAKE, true)
        );
    }
}
