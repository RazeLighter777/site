+++
date = '2026-03-01T14:50:35-05:00'
draft = false
title = 'Non-stick authentication'
type = 'post'
description = 'Using PAM+TPM2 to improve the UX of Linux Auth'
+++

# Non-stick authentication: using PAM + TPM2 to improve UX of Linux Auth

You might be interested in this post if you are curious about Linux authentication, don't know what a TPM actually does, or
are interested in the security / UX of Linux desktops.

Or if you wanna use a TPM2-backed PIN to unlock your desktop for some reason.

I'll talk about PAM generally, explain my motivation for making new PAM modules, and explain some details that I wished were more accessible during my journey to understand how the frick to actually use the TPM.

_AI assistance was NOT used in the generation of this blog post. I don't expect you to read something I couldn't be bothered to write._

## What is PAM?

Pluggable Authentication Modules (PAM) are the silent atlas shouldering the heavy burden of authentication and identity management for the most of the world's most popular open source operating systems.

PAM is not a specific software project, but rather a standard proposed by Sun Microsystems in [RFC 86.0](https://www.kernel.org/pub/linux/libs/pam/pre/doc/rfc86.0.txt.gz) back in 1995, originally for use with the KDE predecessor, the Common Desktop Environment, and geared towards Unix. It was designed to be agnostic to the method used for authentication (password, LDAP, kerberos). Instead, shared libraries implementing a PAM-compatible application binary interface, known as "PAM modules", are dynamically loaded based on a set of rules in human readable configuration files. These PAM modules are called at various times during the PAM conversation, and can set/retrieve state and variables, perform input and output, and a whole bazillion other things.

PAM not only handles logging in, but can handle changing authentication tokens, opening and closing user sessions, password expiry, and a host of other jobs. It runs in a sequential manner, each module in the stack passing the state of the conversation to the next module, the logic dictated with control statements that decide the behavior and success state of the flow being executed.

It's a design elegant in conception. By all means, the design is very successful one that has stood the test of time. You could use Linux for years (and by extension use PAM every day without knowing it), and it's one of the few pieces of software on Linux that has become somewhat of a standard, expected part of the operating system regardless of distribution.

There are several implementations of PAM out there, the first being commercially available ones for Sun Unix, but the landscape is dominated now by two major players, the [Linux PAM project](https://github.com/linux-pam/linux-pam), and the [OpenPAM](https://docs.freebsd.org/en/articles/pam/) implementation used by FreeBSD.

All of the widely used PAM implementations are underappreciated pieces of software; and like many FOSS projects used by everyone, are underfunded
despite being foundational in the technological ecosystem.

The linux-pam implementation is hosted on a [humble GitHub repo](https://github.com/linux-pam/linux-pam), with two maintainers, Dmitry V. Levin and Thorsten Kukuk listed as the giants maintaining this bulwark of the Linux authentication stack.

Despite looking for a button to potentially donate to these two fellows and/or purchase them a beer in toast to their tireless work, I was unsuccessful in my request. If any of the two happen to see this, please reach out and I'd be happy to oblige.

## PIN codes with PAM / why I wrote a PAM module

### Problem: PINs on Linux suck

The motivation came from my girlfriend, who recently switched from Windows 11 to Linux with me. She wanted to use a PIN instead of a password to unlock her computer, as she was used to Windows Hello, which defaults to this type of unlock nowadays. Less keystrokes, less hassle. Simple enough.

```bash

$ passwd
Changing password for user <username>
Current password: <pin entered here>
New password: <pin entered here>
BAD PASSWORD: The password is too short
```

Oh. Seems my distribution included a policy implementing a minimum password complexity. (Said policy is implemented as a PAM module btw; if you weren't convinced PAM is _very_ extensible)

I could simply turn this policy off; and it would achieve the desired end. But it masks the underlying problem: A PIN lacks sufficient entropy to serve as a secure authentication token.
Here I can demonstrate that the entropy of a an eight character alphanumeric password (still _feasibly_ crack-able) and a five digit pin differ by about three times:

This formula calculates the Shannon entropy `H` of a string of length `L` and possible tokens `N`

$$H = L \log_{2}(N)$$

So for a five digit pin:
$$16.60 ≈ 5 \log_{2}(10)$$
And a 8 character ascii password (95 printable characters):

$$52.55 ≈ 8 \log_{2}(95)$$

The entropy difference is clear: PINs of trivial length do not contain sufficient information to be able to withstand brute force attacks on their own.

The problem gets deeper: The hashes for passwords are stored on disks as hashes in the /etc/shadow file, and cracking a four, five, or even six digit PIN is peanuts for a modern processor.

Moreover, on many Linux distributions, the PAM*AUTHTOK, the **plaintext password** passed through PAM, is reused after the pam_authenticate flow in the pam_open_session flow, where it can be used to decrypt keyrings, mount encrypted partitions, and more. This requires making your keyring password \_your actual PIN*. Might as well base64 your keyring at that point.

### There must be a better way.

One way to make a PIN more secure for authentication is to use an external method, providing a PIN as a secret to retrieve a high entropy secret that can be used for cryptographic purposes. This is the approach taken by Smart Cards, some of which require entering a PIN before they can be used for signing and authentication.

But that's not convenient, I don't have a smart card. Nor do I want to require plugging one in, messing with cables, or all that mess. Luckily, modern computers come with what is effectively a built-in smart card, the Trusted Platform Module.

Maybe, just maybe, I can (somehow) store the PIN in the TPM, erasing the need to store it on disk. Let's do some digging:

### What the heck is a TPM anyway?

A good way to understand the TPM is to think of it like a independent Notary and key custodian, diligently observing system behavior, and carefully using it's keys and granting data based requests on the system's behalf / a set of rules (policies).

It has ZERO power to influence the system on its own. It can do typical cryptographic operations, store keys, data blobs, encrypt and decrypt data. It can implement policies, like only allow this key to be used if the system booted with this firmware version. The "independence" aspect of the TPM is the most important thing to understand. If there's any takeaway for how the TPM works, it would be this:

**The TPM does not control the computer, and the computer does not control the TPM.**

TPMs are a misunderstood technology. It doesn't help that when we hear about them in media/news, it's usually around something negative.

Recently:

1. [Windows 11 creating e-waste by forcing TPM2 for new PCs](https://hackaday.com/2025/05/29/forced-e-waste-pcs-and-the-case-of-windows-11s-trusted-platform/)

2. [Play Protect APIs using hardware attestation](https://developer.android.com/google/play/integrity/overview?utm_source=chatgpt.com)

3. [Anti-cheat software for AAA games requiring secure boot + TPM2](https://www.pcgamer.com/hardware/motherboards/fortnite-adds-more-anti-cheat-requirements-including-secure-boot-and-tpm-so-it-might-be-time-to-get-tinkering-in-that-bios/)

But TPM2 is not inherently evil or FOSS-incompatible! In fact, I think they are underused, and can enhance security in many ways that would benefit the open source / Linux community. I encourage you to read this article from LWN on the TPM for a FOSS view of the TPM and it's uses. [Don't fear the TPM](https://lwn.net/Articles/1032026/)

### Fine I'll fix it myself

In doing research, I found a surprising conclusion: There is no existing TPM based PAM module for authentication on Linux.

This excites me; I'll get to build something new! So I open a code editor and get to work planning. I choose C at first, and make a small prototype.

It ends up not going too well, the TPM2 (TPM2 = the modern TPM specification) libraries lack a friendly wrapper, and the documentation for the [TPM2-TSS libraries](https://github.com/tpm2-software/tpm2-tss) is not the greatest.

The TPM2 specifications are a nightmare. While they exist out there online, you can look forward to the messy process of jumping through PDFs, googling for existing code examples to see how they all work together, and looking up obscure error codes to figure out what went wrong. You can find the specifications [here](https://trustedcomputinggroup.org/resource/tpm-library-specification/)

I end up switching to Rust halfway through, and it seems like a better choice. The library I used, [tpm2_esapi](https://docs.rs/tss-esapi/latest/tss_esapi/) is much more friendly, and I have some experience in Rust, and I get a quick prototype going rather quickly.

I create a core rust library for dealing with the TPM abstractions and the core functionality, and then a c-dylib (what rust calls a traditional c-compatible .so file) to create the PAM module. Finally, I create a rust binary, pinutil, which handles the administration, pin setup, teardown, and authorization.

### The missing piece: PinFail

Initially, I thought about just making the pin an empty TPM object that has a simple HMAC authorization policy. Check the supplied pin, if the index unlocks, authorize the user.

This is doable with `tpm2_policyauthvalue` (a documented function of the TPM API), which can be used to seal operations (like read, write, etc) behind a specific secret sequence of bytes.

However, there is no lockout / max attempt / delay mechanism possible at the individual index level. This means that trying all the PINs lets you recover the initial pin, effectively making pin enumeration trivial. There is a "global dictionary attack" feature in TPMs, which can lock out the entire TPM if a given number of authorization attempts fail, but this is a global protection, meaning that locking out a single users pin would lock out all PINs. Annoying.

When searching through the extensive but exceedingly dense TPM2 specifications, I come across an interesting type of index called `PinFail`. Sounds like exactly what I need.

It's a special type of data index that consists of a stored number of attempts and a maximum counter. I instantiated the data type like this in rust (the `repr(C)` part tells Rust to represent the struct in memory in a c-compatible way):

```rust
#[repr(C)]
#[allow(non_snake_case)]
pub struct  PinData {
	pub pinCount:  c_int,
	pub pinLimit:  c_int,
}
```

PinFail can be authorized like any other TPM object, meaning you can authorize it with a PIN, password, or more complex logic/policies.

Most importantly: `PinFail` indexes have a special behavior : the counter is automatically incremented when the authorization fails. Once the limit is reached, successive authorizations will fail automatically.

However, this still has a pitfall. By default, if the index is writable, an attacker can reset the PIN attempts back down to zero, and proceed to do the same brute-force attack as before. So we need another piece.

### PinFail + Policy

The answer was to use another (slightly) less obscure TPM feature, called `tpm2_policynvwritten`. This "policy" (meaning a set of rules attached to a specific object in the TPM) essentially let's one restrict the writing of indexes after creation. If we correctly configure the PinFail index with this type of policy, we can prevent resetting of the PinFail counter _even with total system comprimise_. (Remember! We can do this because the TPM is independent from the system. The system has no direct access to the TPM internals.)

This way, resetting the PIN will also require deleting the entire index, which makes the initial PIN unrecoverable once the PinFail attempts are exhausted.

So the abstraction used for the index is like this:

Data: a PinFail index with two fields, maximum attempts and attempts used. Example:

```
let users_pin = PinData { pinCount = 0; pinLimit = 5 };
```

Attribute: TPMA_NV_WRITTEN set.

```
ctx.policy_nv_written(policy_session, false)?; // We have to write at least once, so written flag is set to false.
```

Policies:

1. `tpm2_policyauthvalue` with the user's PIN as the token.

2. `tpm2_policynvwritten` (policy is to only allow writes if TPMA_NV_WRITTEN is unset)

Effectively, this makes the index write-once, and the written flag gets set as soon as we actually write the `PinData` struct, meaning the PinFail index can never be changed by the system, only by the TPM's counter logic.

Now we simply store the index for each user at a fixed position + uid, and voila! Secure, hardware backed PIN stored in the TPM. The PIN is much more difficult to dump!

The UX looks like this:

```bash
[justin@zenbox ~]$ pinutil setup
Enter new PIN:
Confirm PIN:
✅ PIN set for user: justin
```

### Making it into a PAM module

The Linux kernel natively supports the TPM. On most systems with a tpm, you'll see two special devices on your `/dev` filesystem. One is called `/dev/tpm0` and another `/dev/tpmrm0`. The distinction between the two is subtle, but tldr; you'll probably want to use `/dev/tpmrm0`.

The `/dev/tpm0` is the older of the two, and simply exposes the TPM directly to userspace. However, the TPM does not support concurrent operations, and essentially if more than one process wants to use this device, they must coordinate. This used to be done with a userspace daemon over a unix socket, [tpm2-armbd](https://github.com/tpm2-software/tpm2-abrmd/blob/master/README.md), but the kernel has since introduced a native abstraction for this, called the TPM resource manager. `/dev/tpmrm0` is this resource managed version of the TPM, where the kernel will coordinate multiple application's access to the TPM.

One small problem is, by default, accessing `/dev/tpm0` or `/dev/tmprm0` requires root privileges. To solve this, I create a dedicated tss group, and udev rules that ensure that the `/dev/tpmrm0` device is mounted with the appropriate group access.

```
# TPM device access for tss group (/etc/udev/rules.d/99-tss)
KERNEL=="tpm[0-9]*", TAG+="systemd", MODE="0660", GROUP="tss"
KERNEL=="tpmrm[0-9]*", TAG+="systemd", MODE="0660", GROUP="tss"
```

Finally, I add the setgid flag to the pinutil binary to enable it to access the TPM device node. This is much better than a setuid root binary, but still could be improved with system socket activation which I could use to make it not require setgid at all in the future.

```bash
chgrp tss /bin/pinutil
chmod g+s /bin/pinutil
```

The PAM module is nothing more than a shim that calls `pinutil test <username>`. To prevent path substitution attacks, I require the hardcoded absolute path to the pinutil be present in the configuration file.

```bash
[justin@zenbox]$ cat /etc/pinpam/policy
pin_min_length=4
pin_max_length=6
pin_lockout_max_attempts=5
pinutil_path=/bin/pinutil
```

Finally, you set up your PAM configuration for your particular service you want to use TPM authentication with like this:

```

auth sufficient libpinpam.so

```

This works like a charm, and now I can set up pin authentication for anything PAM supports.

I publish the project, making a nix flake and later an AUR package for the module.

### But: the UX still sucks.

But suddenly, I start seeing messages on my desktop, asking me to manually unlock my keyring when I login with my PIN. Annoying.

But this makes sense. I use (kwallet)[https://github.com/KDE/kwallet], a KDE project that services as a keyring manager for WiFi passwords, ssh keys, and other secrets. Kwallet along with some other crypto-adjacent applications are sometimes shipped with pam modules that can be set up in /etc/pam.d for services to record the PAM_AUTHTOK (the data key storing the authentication token IE **the password**) and pass it to the user session in the pam_open_session handler to actually to the decryption.

And my keyring couldn't unlock because it is encrypted with my password, not my PIN. Hence the prompt. Sure I could change the key to the PIN...

_That's terrible for security though. The entropy of a PIN is terrible and can be brute forced with a potato!!!_

The idea behind the PAM-unlock feature is that the user can automatically unlock their keyring because it is encrypted with the same password they use for login. While this works OK for a simple set up with a single, immutable password, it gets tricky to make this work with other authentication flows. What if the flow expects no password, but a low-entropy pin? What if you want to use a smartcard? Or fingerprint reader? Or what if your password is changed or expires? The keyring isn't joined to the password, the key for one may change without the other. This leads to confusion and annoying password prompts.

One common approach is to unlock the keyring with the [luks password](https://www.freedesktop.org/software/systemd/man/258/pam_systemd_loadkey.html). But this obviously requires full-disk encryption, and it uses the same password for all users providing zero benefit for multi user setups. Not to mention, doesn't cleanly handle LUKS password changes.

I realized that this setup needed work.

### Solution?: TPM master keys

To solve this issue, we need a way to generate a secret for our keyring that is:

1.  High entropy
2.  Unique per user
3.  Inaccessible from an unprivileged context.
4.  Stable across reboots and system changes.
5.  Accessible regardless of the PAM methods used for login

The TPM is more than up to this task! The tpm is capable of creating HMAC indexes, which allow generating keyed hashes based on an input. So if we do something like

```
hmac( $TPM_SECRET_KEY, username)
```

This gives us a per-username unique token we can generate based on the TPM. This works great, and since the TPM device node permissions already can be restricted, we can restrict unprivileged userspace processes from using the index and decrypting the keyrings/disks without authorization.

To improve usability, we also want to allow for recovery... while I won't get into specifics here, moving private keys in and out of the TPM requires making an RSA parent key. We basically create an RSA parent key for the index, and set the parent of the hmac key to said RSA key. This allows us to export the hmac secret to a file (with a recovery phrase), so we can migrate keyrings between systems and recover them in case the user's data is migrated to a system with a different TPM.

But this leaves the question, how do we inject our token into the PAM stack?

### PAM AUTHTOK tomfoolery

Basically, the way keyrings/ecryptfs get the password from PAM in a pretty hacky way. They simply package PAM modules that listen for the token being passed during authentication, and store the resulting token into a variable.

```
auth            optional        pam_kwallet5.so
```

Under the hood, kwallet stores the current AUTHTOK (called password here), into a handle retained between PAM executions.

```
char *key = strdup(password);
result = pam_set_data(pamh, kwalletPamDataKey, key, cleanup_free);
```

`kwalletPamDataKey` is simply:

```
const static char * const kwalletPamDataKey = "kwallet5_key";
```

Then later in the pam_open_session flow:

```
session optional pam_kwallet5.so
```

This module is able to retrieve the authtok and perform the actual decryption.

All of the PAM-integrated modules for ecryptfs, gnome's wallet, and many others work in this same way: listen for the AUTHTOK in the authentication phase, stash it in the pam data, and reuse it later to perform their decryption operations.

So we just need to trick the wallet module into seeing our token instead of the AUTHTOK. Luckily, the AUTHTOK is mutable! We can simply pam_set_item on the authtok in the authentication phase and change the PAM_AUTHTOK to our HMAC-generated key.

In line with the Unix philosophy (do one thing, and do it well), I decided to decouple my solution into another PAM module from the PIN authentication module above. So my module can be used to basically allow decrypting the keyring with any authentication method (or none at all).

My module (libpinpam_master_key.so) is configured like this:

```
...
# Authentication management.
auth [success=2 default=ignore] libpinpam.so # PIN authentication, could be any other module
auth [success=1 default=ignore] pam_unix.so #regular unix password auth. again could be any pam module you want.
# you can add more auth methods if needed or remove ones.
auth requisite pam_deny.so # denies the login, only invoked if no auth methods succeeded.
auth optional libpinpam_master_key.so # switch authtok to the TPM2 hmac-derived token.
auth            optional        pam_kwallet5.so # stash our newly updated authtok with our token so kwallet gets the right key.
auth requisite pam_permit.so #allow the authentication.
...
session optional pam_kwallet5.so # perform the decryption with our authtok when the user opens a session
...
```

(And yes I know this is complex; I wish there was a better way. More on the UX of this below)

The `[success=N default=ignore]` part might seem a bit confusing, but the `success=N` part indicates how many lines ahead we want to skip if the authentication succeeds. The `default=ignore` part just "ignores" the result of the auth itself, and allows the PAM flow to continue if a single authentication method fails. (meaning either PIN or password will work for authentication).

Effectively, this means that no matter what authentication method we use, kwallet/ecryptfs/gnome keyring will all see our token instead of the real password.

### UX for the master key.

There is a little bit of setup for the master key.

```
[justin@zenbox ~]$ sudo pinutil master-key init
WARNING: This will initialize a new TPM-backed master key.
WARNING: Existing automated unlocks depending on the old token will break.
Proceed? (y/N):
```

This will generate an HMAC key in the TPM, and allow the administrator to create a recovery phrase, and store a copy encrypted with the recovery phase on disk.

You can also manually generate the token for a user (if you are root) to allow for migration/changing passwords of existing disks/keyrings.

```
[justin@zenbox ~]$ sudo pinutil master-key get-user-token justin
<random token here, omitted because it is sensitive>
```

### Conclusion

While my solution works, it highlights a problem with secret management / authentication on the Linux desktop. PAM is a noble effort and a time-tested standard for handling authentication, but it scales poorly for workstation/desktop usecases. Configuring this module is very tedious, and I can't even really publish a guide for how to configure my PAM master key module, because there are so many different possible setups and combinations of configurations in PAM, getting a working reliable set up requires a couple trips to the manpages and some trial and error. Want multifactor authentication? Fingerprint sign in? Want your lockscreen to use a different authentication method than your login manager? Research and deep planning is required.

I think PAM as an underlying system is a great idea, but I think a graphical tool that improves the complex state of configuration before we have a "Year of the Linux Desktop".

Linux security philosophy in general tends to lean more barrier between normal users and root. But `/home` is where the heart is! And we see guides on the Arch Linux wiki like [this](https://wiki.archlinux.org/title/KDE_Wallet#Tips_and_tricks) advocating setting an empty password for kwallet, essentially dumping all your sensitive information where any program can see it. Sure, you might have a password to get into sudo, but that's moot if you have the same exact password saved in your wallet as a saved ssh password for another host.

### Disclaimers

The source code for this project, including both of the pam modules, lives [here](https://github.com/RazeLighter777/pinpam), in the dev branch, as a proof-of-concept. Because AI assistance was used in the generation of the POC for the TPM master key, I'm going to perform a full rewrite with no AI assistance before this code gets anywhere near a release tag. It is in my view unacceptable to blindly merge code in a security-sensitive context that I have no ability to take accountability for. I appreciate your patience.

I am open to suggestions on ways to improve, if you have any ideas please submit an issue (preferably with a matching PR fixing it).
