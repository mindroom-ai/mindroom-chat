package com.mindroom_ai.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MindRoomRouteResolverTest {

    @Test
    public void resolvesAppRoutesToIndexHtmlRegardlessOfDots() {
        String[] spaRoutes = {
            "/",
            "/home",
            "/home/create",
            "/home/join",
            "/home/search",
            "/home/!room:localhost",
            "/home/!room:mindroom.chat",
            "/home/!abc:example.sh",
            "/home/!abc:example.com",
            "/home/!room:example.js",
            "/home/!room:example.mp4",
            "/home/!room:cordova.js",
            "/home/!room%3Amindroom.chat/%24event%3Amatrix.org",
            "/home/%23alias%3Amindroom.chat?threadId=%24thread#reply",
            "/direct",
            "/direct/create",
            "/direct/!room:matrix.org",
            "/direct/%23room%3Amatrix.org/%24event%3Amatrix.org",
            "/explore",
            "/explore/featured",
            "/explore/mindroom.chat",
            "/threads",
            "/threads/!room%3Amindroom.chat/%24event%3Amatrix.org",
            "/activity",
            "/activity/invites",
            "/activity/!room%3Amindroom.chat/%24event%3Amatrix.org",
            "/quick-capture",
            "/login",
            "/login/mindroom.chat",
            "/register",
            "/register/mindroom.chat",
            "/reset-password",
            "/reset-password/mindroom.chat",
            "/connect",
            "/connect?code=ABCD-EFGH",
            "/invite",
            "/shell-approval",
            "/connections",
            "/settings",
            "/settings/general",
            "/canvases",
            "/usage",
            "/p/example",
            "/p/example/files/a/b.txt",
            "/!space:mindroom.chat",
            "/!space:mindroom.chat/lobby",
            "/!space:mindroom.chat/threads",
            "/!space:mindroom.chat/search",
            "/!space:mindroom.chat/!room:example.sh/$event:matrix.org",
            "/#space:matrix.org",
            "/#space:matrix.org/lobby",
            "/#space:matrix.org/!room:mindroom.chat",
            "/%21space%3Amindroom.chat",
            "/%21space%3Amindroom.chat/!room%3Amindroom.chat",
            "/%23space%3Amatrix.org",
            "/%23space%3Amatrix.org/threads",
            "/home#section",
            "/?utm=1"
        };

        for (String route : spaRoutes) {
            assertTrue("Expected SPA route: " + route, MindRoomRouteResolver.isSpaRoute(route));
            assertEquals("Expected /index.html for: " + route, "/index.html", MindRoomRouteResolver.resolvePath(route));
        }
    }

    @Test
    public void leavesStaticAssetAndInternalPathsUnchanged() {
        String[] assetPaths = {
            "/index.html",
            "/assets/index-abc123.js",
            "/assets/style.css",
            "/assets/module.wasm",
            "/config.json",
            "/version.json",
            "/manifest.json",
            "/notices.json",
            "/pdf-frame.html",
            "/pdf-frame.js",
            "/viewport.js",
            "/public/locales/en.json",
            "/public/licenses/LICENSE",
            "/res/icons/mindroom-192.png",
            "/sound/ping.mp3",
            "/favicon.ico",
            "/cordova.js",
            "/missing.js",
            "/.well-known/assetlinks.json",
            "/_capacitor_file_/data/user/0/com.mindroom_ai.app/cache/clip.mp4",
            "/_capacitor_content_/media/external/images/1",
            "/assets/main.js#hash"
        };

        for (String assetPath : assetPaths) {
            assertFalse("Expected non-SPA path: " + assetPath, MindRoomRouteResolver.isSpaRoute(assetPath));
            assertEquals("Expected unchanged path: " + assetPath, assetPath, MindRoomRouteResolver.resolvePath(assetPath));
        }
    }

    @Test
    public void handlesNullEmptyAndQueryOnlyInputsSafely() {
        assertFalse(MindRoomRouteResolver.isSpaRoute(null));
        assertNull(MindRoomRouteResolver.resolvePath(null));

        assertFalse(MindRoomRouteResolver.isSpaRoute(""));
        assertEquals("", MindRoomRouteResolver.resolvePath(""));

        assertFalse(MindRoomRouteResolver.isSpaRoute("?only=query"));
        assertEquals("?only=query", MindRoomRouteResolver.resolvePath("?only=query"));
    }

    @Test
    public void doesNotTreatSimilarPrefixAssetNamesAsSpaRoutes() {
        String[] nonSpaPaths = {
            "/home.js",
            "/homes/file.txt",
            "/direct.css",
            "/login.html",
            "/connect.json",
            "/plugin.js",
            "/public/home/file.json"
        };

        for (String path : nonSpaPaths) {
            assertFalse("Expected non-SPA path: " + path, MindRoomRouteResolver.isSpaRoute(path));
            assertEquals(path, MindRoomRouteResolver.resolvePath(path));
        }
    }
}
