# dmgbuild settings for MindRoom.dmg (scripts/build-macos-app.sh): the app and an Applications
# link side by side on background.png, which background.html renders.
# Run as: dmgbuild -s settings.py -D app=<path to MindRoom.app> MindRoom <output.dmg>
app = defines["app"]  # noqa: F821 (dmgbuild provides defines)

format = "UDZO"
files = [(app, "MindRoom.app")]
symlinks = {"Applications": "/Applications"}
# Relative to the repository root, where the build script runs. dmgbuild combines it with
# background@2x.png into one HiDPI TIFF.
background = "scripts/macos-dmg/background.png"

window_rect = ((200, 120), (660, 400))
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
default_view = "icon-view"
show_icon_preview = False
icon_size = 128
text_size = 13
icon_locations = {"MindRoom.app": (180, 160), "Applications": (480, 160)}
hide_extensions = ["MindRoom.app"]
