# Installer

Installer is a set of scripts for installing and tweaking services, apps and operating system on Ubuntu servers.

Written in bash so it can be executed on any linux os without the need to preinstall 3rd party scripting language on the server.

It is being developed in order to help DevOps to simplify automation of server installation.

We'd love to this see developed and grow. Feel free to add, improve, fix, comment your ideas to improve this set of tools.


# What's included:

apps/ - application installation scripts (such as wordpress, drupal, magento, owncloud, etc).

services/ - services installations scripts (such as mySQL, MariaDB, NGIiNX, php, php-fpm, etc.).

tweaks/ - Operating system tweaks and tools to harden and optimize server's performance and security (such as removing unnecessary repository, enabling firewall, etc.)


# How to Use
git clone https://www.github.com/cloudwm/installer.git

edit installer.conf file and customize installer.sh 

Execute ./installer.sh

Thanks and enjoy,
