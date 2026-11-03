{
  description = "mindroom-client development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.python3
            pkgs.just
            pkgs.git
          ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.chromium ];

          shellHook = ''
            # Playwright drives the Nix Chromium; it must not download its own browsers.
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              export CHROMIUM_PATH="${pkgs.chromium}/bin/chromium"
            ''}
          '';
        };
      });
    };
}
