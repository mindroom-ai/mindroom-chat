# Phone top bar and navigation drawer

Date: 2026-11-07. Status: approved for implementation (Bas asked for it; design decided in session, cross-checked with GPT-6 Astra).

## Goal

On phones (`ScreenSize.Mobile`, 750 px wide or less) the app gets a top bar that is always there, and the navigation (icon rail and room list) slides in over the page as a drawer instead of taking turns with it. Tablets and desktops do not change.

Success: in a room on a phone, one tap on the menu button slides the rail and the room list in from the start edge over the room, with a dimmed scrim; picking a room closes it and shows that room; the search field in the bar opens the command palette and shows its shortcut (`⌘ K` or `Ctrl + K`).

## Today

Phones use a stack: a section's root (`/home/`, `/direct/`, `/<space>/`, `/inbox/`, `/explore/`) shows the rail beside a full-width list (`MobileFriendlyClientNav`, `MobileFriendlyPageNav`, `SectionIndex` rendering nothing on phones), and a room hides both and leads its header with a back chevron that returns to the list (a swipe from the start edge does the same).

## Design

### Layout (`shell/ClientLayout.tsx`)

The layout keeps one element tree on every size, so a phone turned sideways (Tablet) does not remount the page:

- index 0: the rail on wider screens, the top bar on phones;
- index 1: a wrapper around the page, `display: contents` on wider screens (no box, so the floating cards layout is untouched), a flex column on phones, `inert` while the drawer is open;
- index 2: on phones the drawer, positioned below the top bar over the page.

### Top bar (`sidebar/PhoneTopBar.tsx`)

- Menu button at the start: opens and closes the drawer, `aria-expanded`, `aria-controls` the drawer. A dot marks any unread room (`allRoomsAtom` through `useRoomsUnread`, as the rail's badges count them), in the highlight color when one mentions the person.
- Search field: a button styled as a field (search icon, "Search", and the palette's shortcut label from `commandPaletteShortcut.ts` in a `kbd` badge) that opens the command palette (`commandPaletteOpenAtom`) over the drawer, which stays as it was: picking a place in the palette navigates and so puts it away.
- The account avatar at the end: the rail's account button (`SettingsTab`) in a top-bar form, its menu opening below it, over the drawer, which stays out (Settings opened from it returns to the same list).

On phones the rail leaves out its own search and account buttons, which the bar now holds.

### Drawer (`sidebar/PhoneNavDrawer.tsx`)

- Holds the rail (the layout's `nav`) and, beside it, a slot that the routed section fills with its list: on phones `MobileFriendlyPageNav` portals the section's list into the slot (React context, such as the space, comes along). Sections without a list (Threads, Canvases, Connections) leave the slot empty and the drawer shows the rail alone.
- Width: rail plus list, `min(100% - 56px, 420px)`; rail only when the slot is empty.
- Motion: the panel slides from the start edge (`transform`, the app's 280 ms motion token) and the scrim fades; mirrored in right-to-left; reduced motion shortens it app-wide. The closed drawer is `inert` and `visibility: hidden`, and drops the rail and the list once it has slid out, as phones had them unmounted inside a room before (page-wide text queries and hidden duplicates stay as they were).
- Open state: `phoneNavDrawerOpenAtom` in `navigation/phoneNavDrawer.ts`, so lower layers (edge swipes) can read it.
- When it opens and closes:
  - Every navigation (new location key) to a section root opens it. A section root is a history entry whose section index page is shown: `SectionIndex` marks it (`useMarkPhoneSectionRoot`), so `/threads/` is not mistaken for a space, and an address that only looks like a space's (a short room link that redirects, a room to join) is not one either.
  - A push or pop to any other page closes it. A replace keeps it as it was (a room's address clean-ups happen while it is out), except a replace that leaves a shown section page (an account restored from another tab); a section page that gives way without a navigation (a space left while it is shown) closes it too.
  - Activating a link inside the drawer closes it, also when the link leads to the URL already shown (a replace).
  - The menu button, a tap on the scrim, Escape (after a menu or dialog over it had the key) and a swipe toward the start edge on the panel close it.
  - An alias address (`/#alias:server/`) shows no page until it turns into a room ID by a replace; that replace decides as the navigation that opened the alias would have (a push from Search closes the drawer, a space's alias still opens it at the space's page).
  - On first render it follows the same rule without motion.
- Focus: opened with the menu button, the drawer takes the focus; brought out by a navigation, it leaves the focus to the page's own restoring; put away around the focus, it returns the focus to the menu button. Escape reaches it in the capture phase wherever the focus is. The menu button keeps one name ("Navigation"); `aria-expanded` says whether the drawer is out, and its unread dot is its description.
- Edge swipes (`navigation/useEdgeSwipe.ts`) do nothing while the drawer is open.
- While the drawer covers a room, the room's automatic read receipts wait as they do for a window without the focus (`timeline/useReaderSees.ts`, in both receipt controllers), and the room is read again when the drawer goes; message notifications count no room on screen meanwhile. Skip to content puts the drawer away before it moves the focus.

### Section index pages (`shell/Router.tsx`, `shell/clientPages.tsx`)

The drawer shows the list, so a phone's section root shows the page a wider screen does behind it (Home and Direct Messages: the welcome page; Explore: Featured). Where wider screens redirect (a space to its lobby, the Inbox to Invites), a phone stays at the section's address and shows that page in place (`SectionIndex`'s `phonePage`), so the way back to the list (a room's back chevron, a sub-page's) lands on the section root with the drawer out.

### Room header on phones (`room/RoomViewHeader.tsx`)

Unchanged: the back chevron and the swipe from the start edge still return to wherever the room was opened from; for a room opened from the list that is the section root, where the drawer comes out with the list. A thread keeps its own back chevron and swipe. (Superseded for the swipe by #98: a room's swipe from the start edge brings the drawer out over the room; the back chevron is unchanged.)

Decision note: a first version dropped the room's back chevron for the menu button. Astra advised keeping it for rooms opened from elsewhere (search results, a notification, another room), and `e2e/sidebar/phone-back-entries.spec.ts` and the iOS edge swipe show that contextual back was built on purpose, so it stays; the menu button is the second way to the list.

## Out of scope

A "new" (+) button in the bar; follow-the-finger dragging of the drawer; tablet and desktop layouts.

## Testing

- Unit: the open/close rule (pure function of navigation type, section-root match and previous state), the top bar's search label, the rail leaving out search and account on phones.
- e2e (`e2e/sidebar/phone-nav-drawer.spec.ts`, 390 by 844 with touch): the bar is visible in a room; the menu opens the drawer with rail and list over the room and the room stays mounted; picking a room closes it; picking a space keeps it open with that space's list; scrim, Escape, the menu and a sideways swipe close it; a room's back chevron and edge swipe return to the list with the drawer out; reduced motion has no transition; right-to-left mirrors; the search field opens the palette with the shortcut shown.
- Existing phone specs that assumed the stack (rail beside a full-width list, the bar's height) are updated, and the phone specs run on a runner, with each failure compared against the base commit.
