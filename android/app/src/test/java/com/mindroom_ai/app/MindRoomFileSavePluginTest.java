package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class MindRoomFileSavePluginTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    @Test
    public void safeFileNamePreservesValidNames() {
        assertEquals("report.pdf", MindRoomFileSavePlugin.safeFileName("report.pdf"));
        assertEquals("quarterly report (2026).pdf", MindRoomFileSavePlugin.safeFileName("  quarterly report (2026).pdf  "));
        assertEquals("archive.tar.gz", MindRoomFileSavePlugin.safeFileName("archive.tar.gz"));
        assertEquals("résumé 日本語.pdf", MindRoomFileSavePlugin.safeFileName("résumé 日本語.pdf"));
    }

    @Test
    public void safeFileNameStripsPathSeparatorsAndTraversal() {
        assertEquals("passwd", MindRoomFileSavePlugin.safeFileName("../../etc/passwd"));
        assertEquals("report.pdf", MindRoomFileSavePlugin.safeFileName("/var/tmp/report.pdf"));
        assertEquals("notes.txt", MindRoomFileSavePlugin.safeFileName("C:\\Users\\alice\\notes.txt"));
        assertEquals("bar", MindRoomFileSavePlugin.safeFileName("foo/bar/"));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("foo/.."));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("/"));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("\\"));
    }

    @Test
    public void safeFileNameStripsControlCharsAndLeadingDots() {
        assertEquals("hidden.txt", MindRoomFileSavePlugin.safeFileName("..hidden.txt"));
        assertEquals("env", MindRoomFileSavePlugin.safeFileName(".env"));
        assertEquals("abc.pdf", MindRoomFileSavePlugin.safeFileName("a\u0000b\rc\n.pdf"));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName(null));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName(""));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("   "));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("."));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName(".."));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("..."));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName(". . ."));
        assertEquals("download", MindRoomFileSavePlugin.safeFileName("\u0000\u0007\n"));
    }

    @Test
    public void resolveMimeTypePrefersNormalizedExplicitMimeType() {
        assertEquals("application/pdf", MindRoomFileSavePlugin.resolveMimeType("application/pdf", "file.bin"));
        assertEquals("text/plain", MindRoomFileSavePlugin.resolveMimeType("TEXT/PLAIN; charset=utf-8", "file.bin"));
        assertEquals(
            "image/png",
            MindRoomFileSavePlugin.resolveMimeType(" image/png ", "file.jpg", ext -> "image/jpeg")
        );
    }

    @Test
    public void resolveMimeTypeFallsBackToSystemLookupThenBuiltInMapThenOctetStream() {
        assertEquals(
            "application/vnd.custom",
            MindRoomFileSavePlugin.resolveMimeType(null, "file.custom", ext -> "custom".equals(ext) ? "application/vnd.custom" : null)
        );
        assertEquals("application/pdf", MindRoomFileSavePlugin.resolveMimeType(null, "document.PDF"));
        assertEquals("text/markdown", MindRoomFileSavePlugin.resolveMimeType("", "notes.md"));
        assertEquals("image/webp", MindRoomFileSavePlugin.resolveMimeType("invalid-mime", "photo.webp"));
        assertEquals("application/pdf", MindRoomFileSavePlugin.resolveMimeType("*/*", "slides.pdf"));
        assertEquals("application/octet-stream", MindRoomFileSavePlugin.resolveMimeType(null, "README"));
        assertEquals("application/octet-stream", MindRoomFileSavePlugin.resolveMimeType(null, "archive.unknownext"));
        assertEquals("application/octet-stream", MindRoomFileSavePlugin.resolveMimeType(null, null));
    }

    @Test
    public void cleanupStaleOpenExportsRemovesOnlyOldOpenDirectories() throws Exception {
        File exportsRoot = tempFolder.newFolder("mindroom-exports");
        long nowMs = 1_700_000_000_000L;

        File staleOpenDir = new File(exportsRoot, "open-stale");
        assertTrue(staleOpenDir.mkdirs());
        File staleFile = new File(staleOpenDir, "old.pdf");
        try (FileOutputStream out = new FileOutputStream(staleFile)) {
            out.write(new byte[] { 1, 2, 3 });
        }
        assertTrue(staleOpenDir.setLastModified(nowMs - MindRoomFileSavePlugin.STALE_OPEN_MAX_AGE_MS - 1_000L));

        File freshOpenDir = new File(exportsRoot, "open-fresh");
        assertTrue(freshOpenDir.mkdirs());
        File freshFile = new File(freshOpenDir, "new.pdf");
        try (FileOutputStream out = new FileOutputStream(freshFile)) {
            out.write(new byte[] { 4, 5, 6 });
        }
        assertTrue(freshOpenDir.setLastModified(nowMs - 60_000L));

        File sessionDir = new File(exportsRoot, "session-active");
        assertTrue(sessionDir.mkdirs());
        assertTrue(sessionDir.setLastModified(nowMs - MindRoomFileSavePlugin.STALE_OPEN_MAX_AGE_MS - 10_000L));

        MindRoomFileSavePlugin.cleanupStaleOpenExports(exportsRoot, nowMs);

        assertFalse(staleOpenDir.exists());
        assertTrue(freshOpenDir.exists());
        assertTrue(freshFile.exists());
        assertTrue(sessionDir.exists());
    }
}
