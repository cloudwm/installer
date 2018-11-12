# Installer

Installer is a set of scripts for installing services, apps and tweaking operating system on Ubuntu 18.04 LTS server.

It is developed to help DevOps to simplify servers automated installation.

Written in bash so it can be executed on os without the need to preinstall 3rd party scripting language on the server.

We'd love to see this grow. Feel free to add, improve, fix, comment your ideas to improve this set of tools.

# What's included

apps/ - application installation scripts (such as wordpress, drupal, magento, owncloud, etc).

services/ - services installations scripts (such as mySQL, MariaDB, NGiNX, php, php-fpm, etc.).

tweaks/ - Operating system tweaks and tools to harden and optimize server's performance and security (such as removing unnecessary repository, enabling firewall, etc.)

# How to Use

 - Clone Repository:
```
git clone https://www.github.com/cloudwm/installer.git
```

 - Edit installer.conf file and customize installation process.

 - Execute:
```
./installer {installer conf file}
```

# License

This application is allowed to be used, modified and forked by any CWM Cloud Platform, CWM brands and their users. Any use of this application out of CWM Cloud Platform servers is forbidden.

<br />
Thanks and enjoy,<br />
CWM Team<br />
CaaB.io<br />
