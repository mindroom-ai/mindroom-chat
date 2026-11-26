package com.mindroom_ai.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
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
    public void resolveMimeTypeTreatsOctetStreamAsFallbackAndInfersFromFileName() {
        assertEquals("application/pdf", MindRoomFileSavePlugin.resolveMimeType("application/octet-stream", "report.pdf"));
        assertEquals(
            "image/png",
            MindRoomFileSavePlugin.resolveMimeType("APPLICATION/OCTET-STREAM; charset=binary", "photo.png")
        );
        assertEquals(
            "application/vnd.custom",
            MindRoomFileSavePlugin.resolveMimeType(
                "application/octet-stream",
                "file.custom",
                ext -> "custom".equals(ext) ? "application/vnd.custom" : null
            )
        );
        assertEquals(
            "text/markdown",
            MindRoomFileSavePlugin.resolveMimeType(null, "notes.md", ext -> "application/octet-stream")
        );
        assertEquals(
            "application/octet-stream",
            MindRoomFileSavePlugin.resolveMimeType("application/octet-stream", "archive.unknownext")
        );
    }

    @Test
    public void cleanupStaleExportsRemovesOldOpenAndSessionDirectoriesWhilePreservingActiveAndFresh() throws Exception {
        File exportsRoot = tempFolder.newFolder("mindroom-exports");
        long nowMs = 1_700_000_000_000L;
        long staleTime = nowMs - MindRoomFileSavePlugin.STALE_EXPORT_MAX_AGE_MS - 1_000L;

        File staleOpenDir = new File(exportsRoot, "open-stale");
        assertTrue(staleOpenDir.mkdirs());
        try (FileOutputStream out = new FileOutputStream(new File(staleOpenDir, "old.pdf"))) {
            out.write(new byte[] { 1, 2, 3 });
        }
        assertTrue(staleOpenDir.setLastModified(staleTime));

        File freshOpenDir = new File(exportsRoot, "open-fresh");
        assertTrue(freshOpenDir.mkdirs());
        File freshFile = new File(freshOpenDir, "new.pdf");
        try (FileOutputStream out = new FileOutputStream(freshFile)) {
            out.write(new byte[] { 4, 5, 6 });
        }
        assertTrue(freshOpenDir.setLastModified(nowMs - 60_000L));

        File staleSessionDir = new File(exportsRoot, "session-stale");
        assertTrue(staleSessionDir.mkdirs());
        assertTrue(staleSessionDir.setLastModified(staleTime));

        File freshSessionDir = new File(exportsRoot, "session-fresh");
        assertTrue(freshSessionDir.mkdirs());
        assertTrue(freshSessionDir.setLastModified(nowMs - 60_000L));

        String activeId = UUID.randomUUID().toString();
        File activeSessionDir = new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + activeId);
        assertTrue(activeSessionDir.mkdirs());
        assertTrue(activeSessionDir.setLastModified(staleTime));

        File unrelatedDir = new File(exportsRoot, "other-dir");
        assertTrue(unrelatedDir.mkdirs());
        assertTrue(unrelatedDir.setLastModified(staleTime));

        MindRoomFileSavePlugin.cleanupStaleExports(exportsRoot, nowMs, activeId);

        assertFalse(staleOpenDir.exists());
        assertFalse(staleSessionDir.exists());
        assertTrue(freshOpenDir.exists());
        assertTrue(freshFile.exists());
        assertTrue(freshSessionDir.exists());
        assertTrue(activeSessionDir.exists());
        assertTrue(unrelatedDir.exists());
    }

    @Test
    public void isValidSessionIdAcceptsUuidsAndRejectsTraversalOrMalformedIds() {
        assertTrue(MindRoomFileSavePlugin.isValidSessionId(UUID.randomUUID().toString()));
        assertTrue(MindRoomFileSavePlugin.isValidSessionId("12345678-90AB-CDEF-1234-567890ABCDEF"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId(null));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId(""));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("../foo"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("../../etc/passwd"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("12345678-90ab-cdef-1234-567890abcde/"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("------------------------------------"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("12345678-90ab-cdef-1234-567890abcdef0"));
        assertFalse(MindRoomFileSavePlugin.isValidSessionId("12345678-90ab-cdef-1234-567890abcdeg"));
    }

    @Test
    public void findStagedSessionRecoversSingleRegularFileInsideExportsRoot() throws Exception {
        File exportsRoot = tempFolder.newFolder("mindroom-exports-recover");
        String id = UUID.randomUUID().toString();
        File sessionDir = new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + id);
        assertTrue(sessionDir.mkdirs());
        File stagedFile = new File(sessionDir, "report.pdf");
        byte[] expectedBytes = "recovered pdf bytes".getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream out = new FileOutputStream(stagedFile)) {
            out.write(expectedBytes);
        }

        MindRoomFileSavePlugin.StagedSession recovered = MindRoomFileSavePlugin.findStagedSession(exportsRoot, id);

        assertNotNull(recovered);
        assertEquals(sessionDir.getCanonicalFile(), recovered.directory);
        assertEquals(stagedFile.getCanonicalFile(), recovered.file);
        assertArrayEquals(expectedBytes, Files.readAllBytes(recovered.file.toPath()));
    }

    @Test
    public void findStagedSessionRejectsTraversalInvalidStructureAndEscapingSymlinks() throws Exception {
        File exportsRoot = tempFolder.newFolder("mindroom-exports-reject");
        File outsideFile = tempFolder.newFile("secret.txt");

        assertNull(MindRoomFileSavePlugin.findStagedSession(null, UUID.randomUUID().toString()));
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, "../foo"));
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, "../../etc/passwd"));
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, UUID.randomUUID().toString()));

        // Empty session directory
        String emptyId = UUID.randomUUID().toString();
        assertTrue(new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + emptyId).mkdirs());
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, emptyId));

        // Multiple files inside session directory
        String multiId = UUID.randomUUID().toString();
        File multiDir = new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + multiId);
        assertTrue(multiDir.mkdirs());
        assertTrue(new File(multiDir, "a.bin").createNewFile());
        assertTrue(new File(multiDir, "b.bin").createNewFile());
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, multiId));

        // Subdirectory instead of regular file
        String nestedDirId = UUID.randomUUID().toString();
        File nestedDir = new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + nestedDirId);
        assertTrue(new File(nestedDir, "subdir").mkdirs());
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, nestedDirId));

        // Symlink inside session directory pointing outside exportsRoot
        String symlinkFileId = UUID.randomUUID().toString();
        File symlinkFileDir = new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + symlinkFileId);
        assertTrue(symlinkFileDir.mkdirs());
        Files.createSymbolicLink(new File(symlinkFileDir, "escape.txt").toPath(), outsideFile.toPath());
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, symlinkFileId));

        // Session directory itself is a symlink pointing outside exportsRoot
        String symlinkDirId = UUID.randomUUID().toString();
        File outsideDir = tempFolder.newFolder("outside-dir");
        assertTrue(new File(outsideDir, "file.bin").createNewFile());
        Files.createSymbolicLink(
            new File(exportsRoot, MindRoomFileSavePlugin.SESSION_DIR_PREFIX + symlinkDirId).toPath(),
            outsideDir.toPath()
        );
        assertNull(MindRoomFileSavePlugin.findStagedSession(exportsRoot, symlinkDirId));
    }
}
