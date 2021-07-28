dataplaneapi {
  host = "0.0.0.0"
  port = 5555

  user "admin" {
    insecure = true
    password = "adminpwd"
  }

  transaction {
    transaction_dir = "/tmp/haproxy"
  }
}

haproxy {
  config_file = "/etc/haproxy/haproxy.cfg"
  haproxy_bin = "/usr/sbin/haproxy"

  reload {
    reload_cmd  = "systemctl reload haproxy"
    restart_cmd = "systemctl restart haproxy"
    reload_delay = "5"
  }
}
