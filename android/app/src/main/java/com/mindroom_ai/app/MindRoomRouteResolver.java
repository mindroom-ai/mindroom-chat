package com.mindroom_ai.app;

import java.util.Set;

/**
 * Resolves MindRoom SPA routes to {@code /index.html} while leaving static assets unchanged.
 * Route roots mirror {@code src/app/routes/paths.ts} and iOS {@code MindRoomRouter}.
 */
public final class MindRoomRouteResolver {

    public static final String INDEX_PATH = "/index.html";

    private static final Set<String> SPA_ROOTS = Set.of(
        "home", "direct", "explore", "threads", "activity", "quick-capture",
        "login", "register", "reset-password", "connect", "invite",
        "shell-approval", "connections", "settings", "canvases", "usage", "p"
    );

    private MindRoomRouteResolver() {}

    public static boolean isSpaRoute(String path) {
        if (path == null || path.isEmpty()) return false;
        int queryIndex = path.indexOf('?');
        String cleanPath = queryIndex >= 0 ? path.substring(0, queryIndex) : path;
        int len = cleanPath.length();
        int start = 0;
        while (start < len && cleanPath.charAt(start) == '/') start++;
        if (start == len) return len > 0;

        int end = start;
        while (end < len) {
            char ch = cleanPath.charAt(end);
            if (ch == '/' || (ch == '#' && end > start)) break;
            end++;
        }

        String first = cleanPath.substring(start, end);
        return SPA_ROOTS.contains(first)
            || first.startsWith("!")
            || first.startsWith("#")
            || first.startsWith("%21")
            || first.startsWith("%23");
    }

    public static String resolvePath(String path) {
        return isSpaRoute(path) ? INDEX_PATH : path;
    }
}
