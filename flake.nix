{
  description = "DevShell for a Hugo + Tailwind static site";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

      in {
        devShells.default = pkgs.mkShell {
          name = "hugo-tailwind-shell";

          buildInputs = [
            pkgs.hugo
            pkgs.nodejs_20
            pkgs.npm
          ];

          shellHook = ''
            echo "💻 Hugo + Tailwind dev shell ready!"
            echo "Run: hugo server -D"
            echo "or: npx tailwindcss -i ./input.css -o ./static/output.css --watch"
          '';
        };
      });
}

