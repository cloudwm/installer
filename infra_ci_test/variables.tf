variable "api_client_id" {
  description = "kamatera client id"
  type        = string
}

variable "api_secret" {
  description = "kamatera client secret"
  type        = string
}

variable "password" {
  description = "Service default password"
  type        = string
}

variable "datacenter" {
  description = "Datcenter ID's"
  type        = list(string)
  default     = ["IL", "IL-PT", "IL-RH", "IL-TA", "IL-HA"]
}

variable "networks" {
  description = "Network names"
  type        = list(string)
  default     = ["wan", "lan-1-ci-test"]
}

variable "image_id" {
  description = "Service name and image id"
  type = list(object({
    name = string
    id   = string
    ram  = number
  }))
  default = [
    {
      name = "ci-test-rancher2.6.2"
      id   = "6000C2902374d7b52d94b0ec5361f16a"
      ram  = 2048
    },
    {
      name = "ci-test-mediawiki1.3x"
      id   = "6000C2902374d7b52d94b0ec5361f16a"
      ram  = 2048
    },
    {
      name = "ci-test-django"
      id   = "6000C29039a6647a4614b609f60cb534"
      ram  = 2048
    },
    {
      name = "ci-test-openproject"
      id   = "6000C29058daf4f5d6854bbb309cad80"
      ram  = 2048
    },
    {
      name = "ci-test-prometheus2.29.2"
      id   = "6000C2902374d7b52d94b0ec5361f16a"
      ram  = 2048
    },
    {
      name = "ci-test-ispconfig3.2"
      id   = "6000C290c0cfbc31d16be7aa76d0f7a1"
      ram  = 2048
    },
    {
      name = "ci-test-ansible-awx"
      id   = "6000C290f479e48dff4c75280c8c6c5e"
      ram  = 8192
    },
    {
      name = "ci-test-tomcat-9"
      id   = "6000C2912408a344530a0327c2d28fc5"
      ram  = 2048
    },
    {
      name = "ci-test-docker-ready"
      id   = "6000C2914925e57f67ce483581932a06"
      ram  = 2048
    },
    {
      name = "ci-test-dokku0.24.8"
      id   = "6000C2915b4f03fb3d6a8310d86f3ebd"
      ram  = 2048
    },
    {
      name = "ci-test-dockermachinecli0.16"
      id   = "6000C291600e9ecc15ca837857314c40"
      ram  = 2048
    },
    {
      name = "ci-test-rabbitmq3.8"
      id   = "6000C291a8f53a5f6cd506c692f5abd4"
      ram  = 2048
    },
    {
      name = "ci-test-litespeed"
      id   = "6000C291d5f701ac8ab70696ac3cdebd"
      ram  = 2048
    },
    {
      name = "ci-test-plesk"
      id   = "6000C291f31096639849b90df58998fa"
      ram  = 2048
    },
    {
      name = "ci-test-lamp"
      id   = "6000C2920688a13c0d09e2416d085793"
      ram  = 2048
    }
  ]
}
