dataplaneapi {
  host = "127.0.0.1"
  port = 5555

  user "admin" {
    insecure = true
    password = "Omci1234!"
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
