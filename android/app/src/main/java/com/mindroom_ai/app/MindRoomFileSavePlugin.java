package com.mindroom_ai.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Function;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "MindRoomFileSave")
public class MindRoomFileSavePlugin extends Plugin {

    static final String DEFAULT_FILE_NAME = "download";
    static final String DEFAULT_MIME_TYPE = "application/octet-stream";
    static final String EXPORTS_DIR_NAME = "mindroom-exports";
    static final String SESSION_DIR_PREFIX = "session-";
    static final String OPEN_DIR_PREFIX = "open-";
    static final long STALE_OPEN_MAX_AGE_MS = 60L * 60L * 1000L;
    private static final Pattern UUID_PATTERN = Pattern.compile(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    );

    private static final Map<String, String> FALLBACK_MIME_TYPES = Map.of(
        "pdf", "application/pdf",
        "txt", "text/plain",
        "md", "text/markdown",
        "csv", "text/csv",
        "json", "application/json",
        "png", "image/png",
        "jpg", "image/jpeg",
        "jpeg", "image/jpeg",
        "webp", "image/webp",
        "mp4", "video/mp4"
    );

    static final class StagedSession {
        final File directory;
        final File file;

        StagedSession(File directory, File file) {
            this.directory = directory;
            this.file = file;
        }
    }

    private static final class ExportSession {
        final String id, pageId, fileName, mimeType;
        final File directory, file;

        ExportSession(String id, String pageId, String fileName, String mimeType, File directory, File file) {
            this.id = id;
            this.pageId = pageId;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.directory = directory;
            this.file = file;
        }
    }

    private final ExecutorService saveExecutor = Executors.newSingleThreadExecutor();
    private ExportSession activeSession;
    private boolean pickerActive;
    private volatile boolean destroyed;

    @PluginMethod
    public void beginSave(PluginCall call) {
        String pageId = call.getString("pageId");
        if (pageId == null || pageId.isEmpty()) {
            call.reject("Save page is missing", "INVALID_PAGE");
            return;
        }
        String fileName = safeFileName(call.getString("fileName"));
        String mimeType = call.getString("mimeType");

        submitTask(call, "Unable to start save prompt", () -> {
            if (pickerActive || (activeSession != null && activeSession.pageId.equals(pageId))) {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS");
                return;
            }
            cleanupActiveSession();
            Context context = getContext();
            if (context == null) {
                call.reject("Unable to start save prompt", "PLUGIN_UNAVAILABLE");
                return;
            }

            File exportsRoot = new File(context.getCacheDir(), EXPORTS_DIR_NAME);
            cleanupStaleOpenExports(exportsRoot, System.currentTimeMillis());

            String id = UUID.randomUUID().toString();
            File sessionDir = new File(exportsRoot, SESSION_DIR_PREFIX + id);
            File file = new File(sessionDir, fileName);
            try {
                if (!sessionDir.mkdirs() && !sessionDir.isDirectory()) {
                    throw new IOException("Unable to create export directory");
                }
                new FileOutputStream(file).close();
            } catch (IOException e) {
                deleteRecursively(sessionDir);
                call.reject("Unable to prepare attachment", "FILE_WRITE_FAILED", e);
                return;
            }

            activeSession = new ExportSession(id, pageId, fileName, mimeType, sessionDir, file);
            call.resolve(new JSObject().put("id", id));
        });
    }

    @PluginMethod
    public void appendSave(PluginCall call) {
        String id = call.getString("id");
        String encodedData = call.getString("data");
        if (id == null || encodedData == null) {
            call.reject("Attachment data is missing", "INVALID_DATA");
            return;
        }
        submitTask(call, "Unable to continue save", () -> {
            if (activeSession == null || !activeSession.id.equals(id) || pickerActive) {
                call.reject("Save session is unavailable", "INVALID_SESSION");
                return;
            }
            byte[] bytes;
            try {
                bytes = Base64.decode(encodedData, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                cleanupActiveSession();
                call.reject("Attachment data is invalid", "INVALID_DATA", e);
                return;
            }
            try (FileOutputStream out = new FileOutputStream(activeSession.file, true)) {
                out.write(bytes);
            } catch (IOException e) {
                cleanupActiveSession();
                call.reject("Unable to prepare attachment", "FILE_WRITE_FAILED", e);
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void presentSave(PluginCall call) {
        String id = call.getString("id");
        if (!isValidSessionId(id)) {
            call.reject("Save session is missing", "INVALID_SESSION");
            return;
        }
        String requestedMimeType = call.getString("mimeType");
        submitTask(call, "Unable to show save prompt", () -> {
            if (activeSession == null || !activeSession.id.equals(id)) {
                call.reject("Save session is unavailable", "INVALID_SESSION");
                return;
            }
            if (pickerActive) {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS");
                return;
            }
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                cleanupActiveSession();
                call.reject("Unable to show save prompt", "PRESENTATION_UNAVAILABLE");
                return;
            }
            String mimeType = resolveAndroidMimeType(
                requestedMimeType != null && !requestedMimeType.trim().isEmpty() ? requestedMimeType : activeSession.mimeType,
                activeSession.fileName
            );
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mimeType)
                .putExtra(Intent.EXTRA_TITLE, activeSession.fileName);

            pickerActive = true;
            String sessionId = activeSession.id;
            activity.runOnUiThread(() -> {
                if (destroyed || activity.isFinishing() || activity.isDestroyed()) {
                    failPresentation(call, sessionId);
                    return;
                }
                try {
                    startActivityForResult(call, intent, "handleCreateDocumentResult");
                } catch (ActivityNotFoundException | SecurityException e) {
                    failPresentation(call, sessionId);
                }
            });
        });
    }

    @ActivityCallback
    private void handleCreateDocumentResult(PluginCall call, ActivityResult result) {
        int resultCode = result != null ? result.getResultCode() : Activity.RESULT_CANCELED;
        Intent data = result != null ? result.getData() : null;
        Uri destinationUri = data != null ? data.getData() : null;
        String callSessionId = call != null ? call.getString("id") : null;

        if (!runOnExecutor(() -> {
            ExportSession current = activeSession;
            boolean matchesActive = current != null && (callSessionId == null || current.id.equals(callSessionId));
            if (matchesActive || current == null) {
                pickerActive = false;
            }

            File sessionDirToDelete = null;
            File sourceFile = null;
            if (matchesActive) {
                activeSession = null;
                sessionDirToDelete = current.directory;
                sourceFile = current.file;
            } else {
                // Recover staged session after Activity recreation / process death from Capacitor's persisted call id.
                Context context = getContext();
                if (context != null && isValidSessionId(callSessionId)) {
                    File exportsRoot = new File(context.getCacheDir(), EXPORTS_DIR_NAME);
                    StagedSession recovered = findStagedSession(exportsRoot, callSessionId);
                    if (recovered != null) {
                        sessionDirToDelete = recovered.directory;
                        sourceFile = recovered.file;
                    }
                }
            }

            if (sourceFile == null) {
                if (call != null) {
                    if (resultCode != Activity.RESULT_OK || destinationUri == null) {
                        call.resolve(new JSObject().put("saved", false));
                    } else {
                        call.reject("Save session is unavailable", "INVALID_SESSION");
                    }
                }
                return;
            }

            try {
                if (resultCode != Activity.RESULT_OK || destinationUri == null) {
                    if (call != null) call.resolve(new JSObject().put("saved", false));
                    return;
                }
                Context context = getContext();
                if (context == null) {
                    if (call != null) call.reject("Unable to save attachment", "PLUGIN_UNAVAILABLE");
                    return;
                }
                try (
                    InputStream in = new FileInputStream(sourceFile);
                    OutputStream out = context.getContentResolver().openOutputStream(destinationUri)
                ) {
                    if (out == null) throw new IOException("Unable to open destination output stream");
                    copyStream(in, out);
                    out.flush();
                }
                if (call != null) call.resolve(new JSObject().put("saved", true));
            } catch (IOException | SecurityException e) {
                if (call != null) call.reject("Unable to save attachment", "FILE_WRITE_FAILED", e);
            } finally {
                deleteRecursively(sessionDirToDelete);
            }
        }) && call != null) {
            call.reject("Unable to save attachment", "PLUGIN_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Save session is missing", "INVALID_SESSION");
            return;
        }
        String requestedMimeType = call.getString("mimeType");
        submitTask(call, "Unable to open attachment", () -> {
            if (activeSession == null || !activeSession.id.equals(id) || pickerActive) {
                call.reject("Save session is unavailable", "INVALID_SESSION");
                return;
            }
            Context context = getContext();
            if (context == null) {
                cleanupActiveSession();
                call.reject("Unable to open attachment", "PLUGIN_UNAVAILABLE");
                return;
            }
            ExportSession session = activeSession;
            activeSession = null;
            File exportsRoot = new File(context.getCacheDir(), EXPORTS_DIR_NAME);
            File openDir = new File(exportsRoot, OPEN_DIR_PREFIX + UUID.randomUUID());
            File openFile = new File(openDir, session.fileName);
            try {
                cleanupStaleOpenExports(exportsRoot, System.currentTimeMillis());
                if (!openDir.mkdirs() && !openDir.isDirectory()) throw new IOException("Unable to create open directory");
                if (!session.file.renameTo(openFile)) {
                    try (InputStream in = new FileInputStream(session.file); OutputStream out = new FileOutputStream(openFile)) {
                        copyStream(in, out);
                    }
                }
                Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", openFile);
                String mimeType = resolveAndroidMimeType(
                    requestedMimeType != null && !requestedMimeType.trim().isEmpty() ? requestedMimeType : session.mimeType,
                    session.fileName
                );
                Intent viewIntent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(contentUri, mimeType)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(viewIntent);
                call.resolve(new JSObject().put("opened", true));
            } catch (ActivityNotFoundException e) {
                deleteRecursively(openDir);
                call.resolve(new JSObject().put("opened", false));
            } catch (IOException | IllegalArgumentException | SecurityException e) {
                deleteRecursively(openDir);
                call.reject("Unable to open attachment", "FILE_OPEN_FAILED", e);
            } finally {
                deleteRecursively(session.directory);
            }
        });
    }

    @PluginMethod
    public void abortSave(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Save session is missing", "INVALID_SESSION");
            return;
        }
        if (!runOnExecutor(() -> {
            if (pickerActive) {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS");
                return;
            }
            if (activeSession != null && activeSession.id.equals(id)) cleanupActiveSession();
            call.resolve();
        })) {
            call.resolve();
        }
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        runOnExecutor(() -> {
            if (pickerActive) {
                // Keep the staged file on disk so a recreated plugin instance can recover and
                // copy its bytes when the SAF picker returns after Activity destruction.
                pickerActive = false;
                activeSession = null;
            } else {
                cleanupActiveSession();
            }
        });
        saveExecutor.shutdown();
        super.handleOnDestroy();
    }

    private void submitTask(PluginCall call, String unavailableMessage, Runnable task) {
        if (destroyed || !runOnExecutor(() -> {
            if (destroyed) {
                call.reject(unavailableMessage, "PLUGIN_UNAVAILABLE");
                return;
            }
            task.run();
        })) {
            call.reject(unavailableMessage, "PLUGIN_UNAVAILABLE");
        }
    }

    private boolean runOnExecutor(Runnable task) {
        try {
            saveExecutor.execute(task);
            return true;
        } catch (RejectedExecutionException e) {
            return false;
        }
    }

    private void failPresentation(PluginCall call, String sessionId) {
        if (!runOnExecutor(() -> {
            if (activeSession != null && activeSession.id.equals(sessionId)) {
                pickerActive = false;
                cleanupActiveSession();
            }
            call.reject("Unable to show save prompt", "PRESENTATION_UNAVAILABLE");
        })) {
            call.reject("Unable to show save prompt", "PRESENTATION_UNAVAILABLE");
        }
    }

    private void cleanupActiveSession() {
        if (activeSession != null) {
            deleteRecursively(activeSession.directory);
            activeSession = null;
        }
    }

    private static String resolveAndroidMimeType(String requestedMimeType, String fileName) {
        return resolveMimeType(requestedMimeType, fileName, ext -> {
            MimeTypeMap map = MimeTypeMap.getSingleton();
            return map != null ? map.getMimeTypeFromExtension(ext) : null;
        });
    }

    static String safeFileName(String requestedName) {
        if (requestedName == null) return DEFAULT_FILE_NAME;
        String trimmed = requestedName.trim();
        int end = trimmed.length();
        while (end > 0 && (trimmed.charAt(end - 1) == '/' || trimmed.charAt(end - 1) == '\\')) end--;
        if (end == 0) return DEFAULT_FILE_NAME;

        String withoutTrailing = trimmed.substring(0, end);
        int lastSep = Math.max(withoutTrailing.lastIndexOf('/'), withoutTrailing.lastIndexOf('\\'));
        String component = lastSep >= 0 ? withoutTrailing.substring(lastSep + 1) : withoutTrailing;

        StringBuilder sanitized = new StringBuilder(component.length());
        for (int i = 0; i < component.length(); i++) {
            char ch = component.charAt(i);
            if (!Character.isISOControl(ch) && ch != '/' && ch != '\\') sanitized.append(ch);
        }
        String cleaned = sanitized.toString().trim();
        int start = 0;
        while (start < cleaned.length() && (cleaned.charAt(start) == '.' || Character.isWhitespace(cleaned.charAt(start)))) {
            start++;
        }
        cleaned = cleaned.substring(start).trim();
        return cleaned.isEmpty() ? DEFAULT_FILE_NAME : cleaned;
    }

    static String resolveMimeType(String requestedMimeType, String fileName) {
        return resolveMimeType(requestedMimeType, fileName, null);
    }

    static String resolveMimeType(String requestedMimeType, String fileName, Function<String, String> systemMimeLookup) {
        String normalized = normalizeMimeType(requestedMimeType);
        if (normalized != null) return normalized;
        String ext = extractExtension(fileName);
        if (ext != null) {
            if (systemMimeLookup != null) {
                String systemMime = normalizeMimeType(systemMimeLookup.apply(ext));
                if (systemMime != null) return systemMime;
            }
            String known = FALLBACK_MIME_TYPES.get(ext);
            if (known != null) return known;
        }
        return DEFAULT_MIME_TYPE;
    }

    private static String normalizeMimeType(String mimeType) {
        if (mimeType == null) return null;
        String trimmed = mimeType.trim();
        int semicolon = trimmed.indexOf(';');
        if (semicolon >= 0) trimmed = trimmed.substring(0, semicolon).trim();
        String lower = trimmed.toLowerCase(Locale.ROOT);
        int slash = lower.indexOf('/');
        if (slash <= 0 || slash == lower.length() - 1 || lower.indexOf('/', slash + 1) >= 0 || lower.contains("*")) {
            return null;
        }
        for (int i = 0; i < lower.length(); i++) {
            char ch = lower.charAt(i);
            if (Character.isWhitespace(ch) || Character.isISOControl(ch)) return null;
        }
        return lower;
    }

    private static String extractExtension(String fileName) {
        if (fileName == null || fileName.isEmpty()) return null;
        String safe = safeFileName(fileName);
        int dot = safe.lastIndexOf('.');
        return (dot <= 0 || dot == safe.length() - 1) ? null : safe.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    static boolean isValidSessionId(String id) {
        return id != null && UUID_PATTERN.matcher(id).matches();
    }

    static StagedSession findStagedSession(File exportsRoot, String id) {
        if (exportsRoot == null || !isValidSessionId(id)) return null;
        try {
            File canonicalRoot = exportsRoot.getCanonicalFile();
            if (!canonicalRoot.isDirectory()) return null;
            String expectedDirName = SESSION_DIR_PREFIX + id;
            File sessionDir = new File(canonicalRoot, expectedDirName).getCanonicalFile();
            if (
                !canonicalRoot.equals(sessionDir.getParentFile()) ||
                !expectedDirName.equals(sessionDir.getName()) ||
                !sessionDir.isDirectory()
            ) {
                return null;
            }
            File[] entries = sessionDir.listFiles();
            if (entries == null || entries.length != 1) return null;
            File rawFile = entries[0];
            File canonicalFile = rawFile.getCanonicalFile();
            if (
                !sessionDir.equals(canonicalFile.getParentFile()) ||
                !rawFile.getName().equals(canonicalFile.getName()) ||
                !canonicalFile.isFile()
            ) {
                return null;
            }
            return new StagedSession(sessionDir, canonicalFile);
        } catch (IOException e) {
            return null;
        }
    }

    static void cleanupStaleOpenExports(File exportsRoot, long nowMs) {
        if (exportsRoot == null || !exportsRoot.isDirectory()) return;
        File[] children = exportsRoot.listFiles();
        if (children == null) return;
        long cutoff = nowMs - STALE_OPEN_MAX_AGE_MS;
        for (File child : children) {
            if (child.getName().startsWith(OPEN_DIR_PREFIX) && child.lastModified() < cutoff) {
                deleteRecursively(child);
            }
        }
    }

    static void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        target.delete();
    }

    private static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = in.read(buffer)) != -1) out.write(buffer, 0, bytesRead);
    }
}
