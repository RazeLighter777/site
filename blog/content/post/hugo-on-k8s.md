+++
date = '2025-11-09T12:48:20-05:00'
draft = false
title = 'Devops-ifying my blog with hugo on k8s'
type = 'post'
description = 'How I deployed hugo on k8s with tailwind, fluxcd, and git-sync'
+++

# Hugo on Kubernetes

I wanted to make a self-hosted blog so I could post projects and write about stuff I find interesting. After some research I decided to use [Hugo](https://gohugo.io/) which seemed to check all the boxes for what I wanted:

- [x] Static html generation
- [x] Usuable with custom CSS frameworks (TailwindCSS in my case)
- [x] Works well with git-based workflows

Because I already run a kubernetes cluster for my homelab, I decided to deploy hugo on k8s. This way I could use my existing infrastructure and take advantage of features like automatic TLS with cert-manager, ingress routing, and gitops with fluxcd.

And no hosting fees!

# Messing around

I first created a flake.nix on my local machine to build the site with hugo and tailwindcss. It looked something like this:

```nix
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
            pkgs.nodejs_24
	    pkgs.caddy
          ];

          shellHook = ''
            echo "💻 Hugo + Tailwind dev shell ready!"
            echo "Run: hugo server -D"
            echo "or: npx tailwindcss -i ./input.css -o ./static/output.css --watch"
          '';
        };
      });
}
```

I entered the shell with `nix develop` and installed the tailwindcss cli with `npm install -D tailwindcss`. Then I created a basic hugo site with `hugo new site blog` and added some sample content.

After messing around and fixing some syntax errors, I was able to build the site locally with `hugo server -D` and see the changes live as I edited the markdown files and CSS.

Seems good so far.

I pulled a makefile from [here](https://github.com/kaushikgopal/henry-hugo/blob/master/Makefile) to help with building and deploying the site:

After consulting my GF for ideas on the color scheme and theme, I settled on a cyberpunk aesthetic with neon accents and dark backgrounds. I used TailwindCSS to style the site and created a custom theme that I liked. You can see the code for the theme [here](https://github.com/RazeLighter777/site).

After getting the site looking how I wanted, I committed the code and moved to my iaas repo where I manage my kubernetes manifests with fluxcd.

# FluxCD

What is fluxcd? From their [website](https://fluxcd.io/): Flux is a set of continuous and progressive delivery solutions for Kubernetes that are open and extensible.

Basically it allows you dto declaratively manage your kubernetes resources with git. You push changes to your manifests in git, and fluxcd syncs those changes to your cluster.

The two main building blocks are Kustomizations and HelmReleases. Kustomizations allow you to manage plain kubernetes manifests, while HelmReleases allow you to manage helm charts. 

I already had fluxcd set up in my cluster to manage my other workloads, so I just needed to add a new Kustomization for my hugo site.

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: blog
  namespace: flux-system
spec:
  interval: 10m0s
  path: ./cluster/apps/blog/app
  prune: true
  wait: true
  retryInterval: 2m
  timeout: 2m
  sourceRef:
    kind: GitRepository
    name: flux-system
  postBuild:
    substituteFrom:
      - kind: Secret
        name: cluster-settings
```

The secret part is just to do some simple `sed 's/{{PLACEHOLDER}}/actual-value/g'` style substitutions for things like domain names and email addresses. In this case I needed to substitute my domain name for the site name `prizrak.me`.

Here's where it got tricky.

# Problem: Syncing the built site

I needed a way to get the built static site files (the output of `hugo build`) into a place where they could be served by a web server.

Most online guides suggested building a custom docker image with hugo and the site files, then deploying that image to kubernetes with a deployment and service. But I think that's overkill for a simple static site, plus it would require me to set up a docker registry to host the image. bleh.

# bjw-s/app-template

I use bjw-s/app-template for a lot of my k8s apps. It's kind of a weird concept, but it's a helm chart for deploying basically any OCI container in a single helm release. It let's you define the container image, resources, ingress, and other settings in a simple chart.

So you can avoid pulling in sketchy usually unmaintained helm charts from who knows where on the internet. Plus a lot of apps are just released as docker images anyway, so why not just use those directly?

My solution ended up involving a single pod with three containers: git-sync, hugomods/hugo, and nginx-unprivileged.

# Git-sync

Git-sync is a simple container that syncs a git repository to a local volume. It can be configured to run as an init container or a sidecar container.

I did both. The init container runs once at startup to clone the repo, and the sidecar container runs continuously to keep the repo up to date. The reason I did both is because I wanted to have the site built and ready to serve as soon as the pod starts, without waiting for the first git-sync sync.

```yaml
controllers:
    main:
        type: deployment
        annotations:
            reloader.stakater.com/auto: "true"
        pod:
            securityContext:
            fsGroup: 65533
            runAsUser: 65533
            runAsGroup: 65533
        initContainers:
            git-sync-init:
            image:
                repository: registry.k8s.io/git-sync/git-sync
                tag: v4.3.0
            securityContext:
                runAsUser: 65533
                runAsGroup: 65533
            env:
                GITSYNC_REPO: https://github.com/razelighter777/site.git
                GITSYNC_ROOT: /git
                GITSYNC_LINK: current
                GITSYNC_ONE_TIME: "true"
```

Simple enough, right?

Well, not quite. The problem is that on updates to the source repo, git-sync wipes out the existing files in the volume and replaces them with the new files from the repo. But because I'm using tailwindcss, I need to install node modules and build the site's html files, which are not stored in git. So if I just let git-sync update the files, I'll lose all the built files and the site will break.

So I created another container whose job is to run `npm install` and `hugo build` whenever the source repo changes. This container mounts the same volume as the git-sync container, so it has access to the latest source files.

```yaml
containers:
    main:
        image:
            repository: docker.io/hugomods/hugo
            tag: nightly-non-root
        command: ["/bin/sh"]
        args:
            - -c
            - |
            LAST_HASH=""
            
            while true; do
                # Get current git hash from outside the blog directory
                CURRENT_HASH=$(readlink /git/current 2>/dev/null || echo "unknown")
                
                # If git sync updated, rebuild everything
                if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
                echo "Detected git update (hash: $CURRENT_HASH), rebuilding site..."
                
                cd /git/current/blog || { echo "Failed to cd, retrying..."; sleep 5; continue; }
                
                # Install npm dependencies
                npm install || { echo "npm install failed, retrying..."; sleep 5; continue; }
                
                # Compile Tailwind CSS
                echo "Compiling Tailwind CSS..."
                npx @tailwindcss/cli -i ./assets/css/input.css -o ./assets/css/output.css || { echo "CSS compilation failed, retrying..."; sleep 5; continue; }
                
                # Build Hugo to output directory
                echo "Building Hugo site..."
                hugo --destination /output --baseURL https://blog.${domain_name} --cacheDir /tmp/hugo_cache || { echo "Hugo build failed, retrying..."; sleep 5; continue; }
                
                LAST_HASH="$CURRENT_HASH"
                echo "Site built successfully"
                fi
                
                sleep 10
            done
        env:
            TZ: ${timezone}
            HOME: /tmp
            npm_config_cache: /tmp/.npm
        resources:
            requests:
            cpu: 100m
            memory: 128Mi
            limits:
            memory: 512Mi

```

A little hacky, but it works. Notice I disabled the hot reload feature since I'm handling it manually with the loop.

It does have to reinstall the node modules on every change, which is a bit slow, but for now it's acceptable since I have like 4 dependencies.

While a lot of sites just use `hugo serve` to serve the site, I wanted to use nginx for a few reasons:

- Hugo says not to use `hugo serve` in production
- I wanted to have more control over caching and headers
- I love nginx

I added a simple nginx container to serve the built static files.

```yaml
nginx:
    image:
        repository: docker.io/nginxinc/nginx-unprivileged
        tag: 1.27-alpine
    resources:
        requests:
            cpu: 50m
            memory: 32Mi
        limits:
            memory: 128Mi
```

The only volumes I needed were the git-sync volume and an output volume for the built site.

```yaml
persistence:
    blog-source:
      enabled: true
      type: emptyDir
      advancedMounts:
          main:
          main:
              - path: /git
          git-sync-init:
              - path: /git
          git-sync:
              - path: /git
    blog-output:
      enabled: true
      type: emptyDir
      advancedMounts:
          main:
          main:
              - path: /output
          nginx:
              - path: /usr/share/nginx/html
                readOnly: true
```

And that's it! With this setup, I have a self-hosted hugo blog running on kubernetes, with automatic updates from git, and styled with tailwindcss. Whenever I push changes to my repo, the site automatically rebuilds and updates in my cluster, within 60 seconds.

