package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MindRoomAuthPluginTest {

    @Test
    public void validatesHttpAndHttpsAuthenticationUrls() {
        assertTrue(MindRoomAuthPlugin.isValidHttpUrl("https://mindroom.chat/_matrix/client/v3/login/sso/redirect"));
        assertTrue(MindRoomAuthPlugin.isValidHttpUrl("  HTTP://localhost:8008/login?next=%2Fhome  "));

        assertFalse(MindRoomAuthPlugin.isValidHttpUrl(null));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl(""));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("   "));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("mindroom://auth/login"));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("javascript:alert(1)"));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("file:///etc/passwd"));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("https://"));
        assertFalse(MindRoomAuthPlugin.isValidHttpUrl("not a url"));
    }

    @Test
    public void normalizesAndMatchesCallbackSchemesCaseInsensitively() {
        assertEquals("mindroom", MindRoomAuthPlugin.normalizeCallbackScheme("mindroom"));
        assertEquals("mindroom", MindRoomAuthPlugin.normalizeCallbackScheme("  MindRoom  "));
        assertEquals("com.mindroom-ai.app+1", MindRoomAuthPlugin.normalizeCallbackScheme("com.mindroom-ai.app+1"));

        assertNull(MindRoomAuthPlugin.normalizeCallbackScheme(null));
        assertNull(MindRoomAuthPlugin.normalizeCallbackScheme(""));
        assertNull(MindRoomAuthPlugin.normalizeCallbackScheme("   "));
        assertNull(MindRoomAuthPlugin.normalizeCallbackScheme("123bad"));
        assertNull(MindRoomAuthPlugin.normalizeCallbackScheme("mindroom://"));

        assertTrue(MindRoomAuthPlugin.matchesCallbackScheme("mindroom", "mindroom://auth/login?loginToken=abc"));
        assertTrue(
            MindRoomAuthPlugin.matchesCallbackScheme(
                "MINDROOM",
                "MindRoom://cloudflare-access#origin=https://hs.example&token=jwt"
            )
        );
        assertFalse(MindRoomAuthPlugin.matchesCallbackScheme("mindroom", "https://chat.mindroom.chat/connect"));
        assertFalse(MindRoomAuthPlugin.matchesCallbackScheme("mindroom", "mindroom2://auth/login"));
        assertFalse(MindRoomAuthPlugin.matchesCallbackScheme("mindroom", ""));
        assertFalse(MindRoomAuthPlugin.matchesCallbackScheme("mindroom", null));
    }

    @Test
    public void trackerRejectsConcurrentCallsAndCompletesOnMatchingCallback() {
        MindRoomAuthPlugin.AuthSessionTracker<String> tracker = new MindRoomAuthPlugin.AuthSessionTracker<>();

        MindRoomAuthPlugin.PendingSession<String> first = tracker.begin("call-1", "mindroom");
        assertNotNull(first);
        assertTrue(tracker.hasPending());
        assertNull(tracker.begin("call-2", "mindroom"));

        // Non-matching intent leaves the pending session intact.
        assertNull(tracker.completeIfMatching("https://chat.mindroom.chat/home"));
        assertTrue(tracker.hasPending());

        // Matching scheme resolves and clears pending state.
        assertEquals("call-1", tracker.completeIfMatching("mindroom://auth/login?loginToken=ok"));
        assertFalse(tracker.hasPending());
        assertNull(tracker.getResumeCancellationCandidate());

        // Subsequent session can now start cleanly.
        assertNotNull(tracker.begin("call-3", "mindroom"));
    }

    @Test
    public void trackerCancelsOnResumeOnlyAfterLaunchAndPauseAndIgnoresStaleCancellation() {
        MindRoomAuthPlugin.AuthSessionTracker<String> tracker = new MindRoomAuthPlugin.AuthSessionTracker<>();
        MindRoomAuthPlugin.PendingSession<String> first = tracker.begin("call-1", "mindroom");
        assertNotNull(first);

        // Before launch/pause, resume does not schedule cancellation.
        assertNull(tracker.getResumeCancellationCandidate());
        tracker.markPaused();
        assertNull(tracker.getResumeCancellationCandidate());

        tracker.markLaunched(first);
        assertNull(tracker.getResumeCancellationCandidate());
        tracker.markPaused();
        assertEquals(first, tracker.getResumeCancellationCandidate());

        // If callback arrives before the delayed cancel runnable executes, cancel becomes a no-op.
        assertEquals("call-1", tracker.completeIfMatching("mindroom://cloudflare-access#origin=https://hs&token=t"));
        assertNull(tracker.cancelIfCurrent(first));

        // A stale cancel runnable from an earlier session never cancels a newer session.
        MindRoomAuthPlugin.PendingSession<String> second = tracker.begin("call-2", "mindroom");
        assertNotNull(second);
        assertNull(tracker.cancelIfCurrent(first));
        assertTrue(tracker.hasPending());

        // Cancelling the active session (e.g. user closed Custom Tabs or destroy) clears it.
        tracker.markLaunched(second);
        tracker.markPaused();
        assertEquals("call-2", tracker.cancelIfCurrent(second));
        assertFalse(tracker.hasPending());
    }
}
