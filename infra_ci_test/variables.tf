variable "api_client_id" {
    type = string
    description = "kamatera client id"
}

variable "api_secret" {
    type = string
    description = "kamatera client secret"
}

variable "password" {
  type= string
  description="Service default password"
}

variable "image_id" {
  type= list(object({
    name = string
    id = string
    ram = number
  }))
  default = [
    {
        name = "ci-rancher2.6.2"
        id = "IL:6000C2902374d7b52d94b0ec5361f16a"
        ram = 2048
    },
    {
        name = "ci-mediawiki1.3x-nginx-mysql8-php7.4"
        id = "IL:6000C2902374d7b52d94b0ec5361f16a"
        ram = 2048
    },
    {
        name = "ci-django-nginx-mysql8-php7.4"
        id = "IL:6000C29039a6647a4614b609f60cb534"
        ram = 2048
    },
    {
        name = "ci-openproject"
        id = "IL:6000C29058daf4f5d6854bbb309cad80"
        ram = 2048
    },
    {
        name = "ci-prometheus2.29.2"
        id = "IL:6000C2902374d7b52d94b0ec5361f16a"
        ram = 2048
    },
    {
        name = "ci-ispconfig3.2-nginx-mysql8-php7.4"
        id = "IL:6000C290c0cfbc31d16be7aa76d0f7a1"
        ram = 2048
    },
    {
        name = "ci-ansible-awx"
        id = "IL:6000C290f479e48dff4c75280c8c6c5e"
        ram = 8192
    },
    {
        name = "ci-tomcat-9"
        id = "IL:6000C2912408a344530a0327c2d28fc5"
        ram = 2048
    },
    {
        name = "ci-docker-ready"
        id = "IL:6000C2914925e57f67ce483581932a06"
        ram = 2048
    },
    {
        name = "ci-dokku0.24.8"
        id = "IL:6000C2915b4f03fb3d6a8310d86f3ebd"
        ram = 2048
    },
    {
        name = "ci-dockermachinecli0.16"
        id = "IL:6000C291600e9ecc15ca837857314c40"
        ram = 2048
    },
    {
        name = "ci-rabbitmq3.8-nginx"
        id = "IL:6000C291a8f53a5f6cd506c692f5abd4"
        ram = 2048
    },
    {
        name = "ci-litespeed-mysql8-php7.4"
        id = "IL:6000C291d5f701ac8ab70696ac3cdebd"
        ram = 2048
    },
    {
        name = "ci-plesk"
        id = "IL:6000C291f31096639849b90df58998fa"
        ram = 2048
    },
    {
        name = "ci-lamp-apache2.4-mysql8-php7.4"
        id = "IL:6000C2920688a13c0d09e2416d085793"
        ram = 2048
    }
  ]
  description="Service name and image id"
}