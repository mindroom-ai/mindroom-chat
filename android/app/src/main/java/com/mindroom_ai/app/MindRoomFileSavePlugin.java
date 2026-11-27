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
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "MindRoomFileSave")
public class MindRoomFileSavePlugin extends Plugin {

    static final String DEFAULT_FILE_NAME = "download";
    static final String DEFAULT_MIME_TYPE = "application/octet-stream";
    static final String EXPORTS_DIR_NAME = "mindroom-exports";
    static final String SESSION_DIR_PREFIX = "session-";
    static final String OPEN_DIR_PREFIX = "open-";
    static final long STALE_EXPORT_MAX_AGE_MS = 60L * 60L * 1000L;

    private static final Pattern UUID_PATTERN = Pattern.compile(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    );
    private static final Map<String, String> FALLBACK_MIME_TYPES = Map.of(
        "pdf", "application/pdf", "txt", "text/plain", "md", "text/markdown",
        "csv", "text/csv", "json", "application/json", "png", "image/png",
        "jpg", "image/jpeg", "jpeg", "image/jpeg", "webp", "image/webp", "mp4", "video/mp4"
    );

    static final class StagedSession {
        final String id, pageId, fileName, mimeType;
        final File directory, file;

        StagedSession(String id, String pageId, String fileName, String mimeType, File directory, File file) {
            this.id = id;
            this.pageId = pageId;
            this.fileName = fileName;
            this.mimeType = mimeType;
            this.directory = directory;
            this.file = file;
        }
    }

    private final ExecutorService saveExecutor = Executors.newSingleThreadExecutor();
    private StagedSession activeSession;
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
            if (pickerActive || (activeSession != null && pageId.equals(activeSession.pageId))) {
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
            cleanupStaleExports(exportsRoot, System.currentTimeMillis(), null);

            String id = UUID.randomUUID().toString();
            File sessionDir = new File(exportsRoot, SESSION_DIR_PREFIX + id);
            File file = new File(sessionDir, fileName);
            try {
                ensureDirectory(sessionDir);
                new FileOutputStream(file).close();
            } catch (IOException e) {
                deleteRecursively(sessionDir);
                call.reject("Unable to prepare attachment", "FILE_WRITE_FAILED", e);
                return;
            }
            activeSession = new StagedSession(id, pageId, fileName, mimeType, sessionDir, file);
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
        withActiveSession(call, "Unable to continue save", false, session -> {
            byte[] bytes;
            try {
                bytes = Base64.decode(encodedData, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                cleanupActiveSession();
                call.reject("Attachment data is invalid", "INVALID_DATA", e);
                return;
            }
            try (FileOutputStream out = new FileOutputStream(session.file, true)) {
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
        String requestedMimeType = call.getString("mimeType");
        withActiveSession(call, "Unable to show save prompt", true, session -> {
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                cleanupActiveSession();
                call.reject("Unable to show save prompt", "PRESENTATION_UNAVAILABLE");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(resolveAndroidMimeType(requestedMimeType, session))
                .putExtra(Intent.EXTRA_TITLE, session.fileName);

            pickerActive = true;
            activity.runOnUiThread(() -> {
                if (destroyed || activity.isFinishing() || activity.isDestroyed()) {
                    failPresentation(call, session.id);
                    return;
                }
                try {
                    startActivityForResult(call, intent, "handleCreateDocumentResult");
                } catch (ActivityNotFoundException | SecurityException e) {
                    failPresentation(call, session.id);
                }
            });
        });
    }

    @ActivityCallback
    private void handleCreateDocumentResult(PluginCall call, ActivityResult result) {
        Uri destinationUri =
            result != null && result.getResultCode() == Activity.RESULT_OK && result.getData() != null
                ? result.getData().getData()
                : null;
        String callSessionId = call != null ? call.getString("id") : null;

        if (!runOnExecutor(() -> {
            StagedSession staged = takeStagedSession(callSessionId);
            try {
                if (destinationUri == null) {
                    if (call != null) call.resolve(new JSObject().put("saved", false));
                } else if (staged == null) {
                    if (call != null) call.reject("Save session is unavailable", "INVALID_SESSION");
                } else {
                    Context context = getContext();
                    if (context == null) {
                        if (call != null) call.reject("Unable to save attachment", "PLUGIN_UNAVAILABLE");
                    } else {
                        copyFileToStream(staged.file, context.getContentResolver().openOutputStream(destinationUri));
                        if (call != null) call.resolve(new JSObject().put("saved", true));
                    }
                }
            } catch (IOException | SecurityException e) {
                if (call != null) call.reject("Unable to save attachment", "FILE_WRITE_FAILED", e);
            } finally {
                if (staged != null) deleteRecursively(staged.directory);
            }
        }) && call != null) {
            call.reject("Unable to save attachment", "PLUGIN_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        String requestedMimeType = call.getString("mimeType");
        withActiveSession(call, "Unable to open attachment", false, session -> {
            Context context = getContext();
            if (context == null) {
                cleanupActiveSession();
                call.reject("Unable to open attachment", "PLUGIN_UNAVAILABLE");
                return;
            }
            activeSession = null;
            File exportsRoot = new File(context.getCacheDir(), EXPORTS_DIR_NAME);
            File openDir = new File(exportsRoot, OPEN_DIR_PREFIX + UUID.randomUUID());
            File openFile = new File(openDir, session.fileName);
            try {
                cleanupStaleExports(exportsRoot, System.currentTimeMillis(), session.id);
                ensureDirectory(openDir);
                if (!session.file.renameTo(openFile)) copyFileToStream(session.file, new FileOutputStream(openFile));
                Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", openFile);
                context.startActivity(
                    new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(contentUri, resolveAndroidMimeType(requestedMimeType, session))
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK)
                );
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
            if (activeSession != null && id.equals(activeSession.id)) cleanupActiveSession();
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

    private void withActiveSession(PluginCall call, String unavailableMessage, boolean forPresent, Consumer<StagedSession> action) {
        String id = call.getString("id");
        if (forPresent ? !isValidSessionId(id) : (id == null || id.isEmpty())) {
            call.reject("Save session is missing", "INVALID_SESSION");
            return;
        }
        submitTask(call, unavailableMessage, () -> {
            if (activeSession == null || !activeSession.id.equals(id) || (!forPresent && pickerActive)) {
                call.reject("Save session is unavailable", "INVALID_SESSION");
                return;
            }
            if (pickerActive) {
                call.reject("A save prompt is already open", "SAVE_IN_PROGRESS");
                return;
            }
            action.accept(activeSession);
        });
    }

    private StagedSession takeStagedSession(String callSessionId) {
        StagedSession current = activeSession;
        boolean matchesActive = current != null && (callSessionId == null || current.id.equals(callSessionId));
        if (matchesActive || current == null) pickerActive = false;
        if (matchesActive) {
            activeSession = null;
            return current;
        }
        // Recover staged session after Activity recreation / process death from Capacitor's persisted call id.
        Context context = getContext();
        return context != null ? findStagedSession(new File(context.getCacheDir(), EXPORTS_DIR_NAME), callSessionId) : null;
    }

    private void submitTask(PluginCall call, String unavailableMessage, Runnable task) {
        if (destroyed || !runOnExecutor(() -> {
            if (destroyed) call.reject(unavailableMessage, "PLUGIN_UNAVAILABLE");
            else task.run();
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
        Runnable reject = () -> call.reject("Unable to show save prompt", "PRESENTATION_UNAVAILABLE");
        if (!runOnExecutor(() -> {
            if (activeSession != null && activeSession.id.equals(sessionId)) {
                pickerActive = false;
                cleanupActiveSession();
            }
            reject.run();
        })) reject.run();
    }

    private void cleanupActiveSession() {
        if (activeSession != null) {
            deleteRecursively(activeSession.directory);
            activeSession = null;
        }
    }

    private static void ensureDirectory(File dir) throws IOException {
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IOException("Unable to create export directory");
    }

    private static String resolveAndroidMimeType(String preferredMimeType, StagedSession session) {
        String specific = normalizeSpecificMimeType(preferredMimeType);
        return resolveMimeType(specific != null ? specific : session.mimeType, session.fileName, ext -> {
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

        String tail = trimmed.substring(0, end);
        String component = tail.substring(Math.max(tail.lastIndexOf('/'), tail.lastIndexOf('\\')) + 1);
        StringBuilder cleaned = new StringBuilder(component.length());
        for (int i = 0; i < component.length(); i++) {
            char ch = component.charAt(i);
            if (!Character.isISOControl(ch) && ch != '/' && ch != '\\') cleaned.append(ch);
        }
        String result = cleaned.toString().trim();
        int start = 0;
        while (start < result.length() && (result.charAt(start) == '.' || Character.isWhitespace(result.charAt(start)))) start++;
        result = result.substring(start).trim();
        return result.isEmpty() ? DEFAULT_FILE_NAME : result;
    }

    static String resolveMimeType(String requestedMimeType, String fileName) {
        return resolveMimeType(requestedMimeType, fileName, null);
    }

    static String resolveMimeType(String requestedMimeType, String fileName, Function<String, String> systemMimeLookup) {
        String normalized = normalizeSpecificMimeType(requestedMimeType);
        if (normalized != null) return normalized;
        if (fileName != null && !fileName.isEmpty()) {
            String safe = safeFileName(fileName);
            int dot = safe.lastIndexOf('.');
            if (dot > 0 && dot < safe.length() - 1) {
                String ext = safe.substring(dot + 1).toLowerCase(Locale.ROOT);
                String systemMime = systemMimeLookup != null ? normalizeSpecificMimeType(systemMimeLookup.apply(ext)) : null;
                if (systemMime != null) return systemMime;
                String known = FALLBACK_MIME_TYPES.get(ext);
                if (known != null) return known;
            }
        }
        return DEFAULT_MIME_TYPE;
    }

    private static String normalizeSpecificMimeType(String mimeType) {
        if (mimeType == null) return null;
        int semicolon = mimeType.indexOf(';');
        String lower = (semicolon >= 0 ? mimeType.substring(0, semicolon) : mimeType).trim().toLowerCase(Locale.ROOT);
        int slash = lower.indexOf('/');
        if (DEFAULT_MIME_TYPE.equals(lower) || slash <= 0 || slash == lower.length() - 1 || lower.indexOf('/', slash + 1) >= 0 || lower.contains("*")) {
            return null;
        }
        for (int i = 0; i < lower.length(); i++) {
            if (Character.isWhitespace(lower.charAt(i)) || Character.isISOControl(lower.charAt(i))) return null;
        }
        return lower;
    }

    static boolean isValidSessionId(String id) {
        return id != null && UUID_PATTERN.matcher(id).matches();
    }

    private static File canonicalChild(File canonicalParent, String name) throws IOException {
        File resolved = new File(canonicalParent, name).getCanonicalFile();
        return canonicalParent.equals(resolved.getParentFile()) && name.equals(resolved.getName()) ? resolved : null;
    }

    static StagedSession findStagedSession(File exportsRoot, String id) {
        if (exportsRoot == null || !isValidSessionId(id)) return null;
        try {
            File canonicalRoot = exportsRoot.getCanonicalFile();
            if (!canonicalRoot.isDirectory()) return null;
            File sessionDir = canonicalChild(canonicalRoot, SESSION_DIR_PREFIX + id);
            if (sessionDir == null || !sessionDir.isDirectory()) return null;
            File[] entries = sessionDir.listFiles();
            if (entries == null || entries.length != 1) return null;
            File canonicalFile = canonicalChild(sessionDir, entries[0].getName());
            return canonicalFile != null && canonicalFile.isFile()
                ? new StagedSession(null, null, canonicalFile.getName(), null, sessionDir, canonicalFile)
                : null;
        } catch (IOException e) {
            return null;
        }
    }

    static void cleanupStaleExports(File exportsRoot, long nowMs, String activeSessionId) {
        File[] children = exportsRoot != null && exportsRoot.isDirectory() ? exportsRoot.listFiles() : null;
        if (children == null) return;
        long cutoff = nowMs - STALE_EXPORT_MAX_AGE_MS;
        String activeDirName = activeSessionId != null ? SESSION_DIR_PREFIX + activeSessionId : null;
        for (File child : children) {
            String name = child.getName();
            if (!name.equals(activeDirName) && (name.startsWith(OPEN_DIR_PREFIX) || name.startsWith(SESSION_DIR_PREFIX)) && child.lastModified() < cutoff) {
                deleteRecursively(child);
            }
        }
    }

    static void deleteRecursively(File target) {
        if (target == null || !target.exists()) return;
        File[] children = target.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        target.delete();
    }

    private static void copyFileToStream(File source, OutputStream out) throws IOException {
        if (out == null) throw new IOException("Unable to open destination output stream");
        try (OutputStream target = out; InputStream in = new FileInputStream(source)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) target.write(buffer, 0, bytesRead);
            target.flush();
        }
    }
}
